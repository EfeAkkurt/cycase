import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createInitialContext } from '../../src/game/context';
import { compactScore, computeScore } from '../../src/game/scoring';
import type { GameContext } from '../../src/game/types';
import {
  API_BASE_PATH,
  API_LIMITS,
  appendBatchRequestSchema,
  appendCommandRequestSchema,
  createRunRequestSchema,
  listCommandsQuerySchema,
  ROUTES,
  withinCommandSizeLimit,
  type AppendBatchData,
  type AppendCommandData,
  type AppendCommandRequest,
  type CreateRunData,
  type ListCommandsData,
  type RunSummaryData,
} from '../../shared/apiContract';
import { hashContext } from '../../shared/runSignature';
import { fail, succeed, type AppContext } from '../app';
import {
  SequenceConflictError,
  type NewCommand,
  type RunRecord,
} from '../persistence/repository';
import {
  replayHistory,
  signatureHash,
  verifyBatch,
} from '../services/replayVerifier';
import {
  generateRunId,
  generateWriteToken,
  hashToken,
  parseBearer,
  runIdLogHash,
  verifyToken,
} from '../services/tokens';

/**
 * Run persistence (contract §6).
 *
 * The invariant every handler in this file serves: the server persists what the
 * browser's engine produced, after re-deriving it from the shared engine, and
 * refuses anything it cannot re-derive. It never writes a gameplay value it
 * computed independently, and a refused write leaves `last_seq` untouched.
 */

type Reply = FastifyReply;
type Request = FastifyRequest;

interface AuthorizedRun {
  run: RunRecord;
}

/** Client key for rate limiting. IP is the only stable signal for anonymous runs. */
function clientKey(request: Request): string {
  return request.ip || 'unknown';
}

async function authorize(
  ctx: AppContext,
  request: Request,
  reply: Reply,
  runId: string,
): Promise<AuthorizedRun | null> {
  const token = parseBearer(request.headers.authorization);
  const run = await ctx.repository.getRun(runId);

  // One message and one status for "no such run" and "wrong token": telling an
  // attacker which of the two it was turns run ids into an enumeration oracle.
  const unauthorized = () =>
    fail(reply, request, 'UNAUTHORIZED', 'This run token is not valid for this run.', {
      recovery: 'Start a new run, or continue offline — local gameplay is unaffected.',
    });

  if (!token || !run) {
    // Still burn a constant-time comparison against a dummy digest so a missing
    // run and a wrong token cost the same.
    verifyToken(token ?? 'absent', '0'.repeat(64));
    unauthorized();
    return null;
  }
  if (!verifyToken(token, run.writeTokenHash)) {
    unauthorized();
    return null;
  }
  if (new Date(run.expiresAt).getTime() <= ctx.now()) {
    fail(reply, request, 'UNAUTHORIZED', 'This run has expired.', {
      recovery: 'Start a new run. Anonymous runs are kept for seven days.',
    });
    return null;
  }

  return { run };
}

function scoreOf(context: GameContext) {
  return compactScore(computeScore(context.scoreEntries));
}

function summarize(run: RunRecord): RunSummaryData {
  return {
    runId: run.id,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    status: run.status,
    lastSeq: run.lastSeq,
    stateVersion: run.stateVersion,
    replaySignature: run.stateHash,
    ending: run.ending,
    score: run.score as RunSummaryData['score'],
    clientBuild: run.clientBuild,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    expiresAt: run.expiresAt,
  };
}

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ---------------------------------------------------------------- *
   * POST /runs
   * ---------------------------------------------------------------- */
  app.post(ROUTES.runs, async (request, reply) => {
    const limit = ctx.rateLimiter.check('run_create', clientKey(request), ctx.config.rateLimits.runCreate);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      return fail(reply, request, 'RATE_LIMITED', 'Too many runs created from this client.', {
        recovery: `Wait ${limit.retryAfterSec} seconds. Local gameplay is unaffected.`,
      });
    }

    const parsed = createRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, request, 'INVALID_INPUT', 'The run request did not match the schema.', {
        recovery: 'Send scenarioId "CASE-001", scenarioVersion 1 and a clientBuild string.',
      });
    }

    const runId = generateRunId();
    const writeToken = generateWriteToken();
    const createdAtMs = ctx.now();
    const expiresAtMs = createdAtMs + ctx.config.runTtlMs;
    const initialStateHash = hashContext(createInitialContext());

    await ctx.repository.createRun({
      id: runId,
      writeTokenHash: hashToken(writeToken),
      scenarioId: parsed.data.scenarioId,
      scenarioVersion: parsed.data.scenarioVersion,
      stateHash: initialStateHash,
      clientBuild: parsed.data.clientBuild,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });

    ctx.logger.log('info', 'run_created', {
      requestId: request.cycaseRequestId,
      run: runIdLogHash(runId),
      scenarioId: parsed.data.scenarioId,
    });

    const data: CreateRunData = {
      runId,
      writeToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      initialStateHash,
    };
    return succeed(reply, request, data, 201);
  });

  /* ---------------------------------------------------------------- *
   * GET /runs/:runId
   * ---------------------------------------------------------------- */
  app.get(`${API_BASE_PATH}/runs/:runId`, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const authorized = await authorize(ctx, request, reply, runId);
    if (!authorized) return reply;
    return succeed(reply, request, summarize(authorized.run));
  });

  /* ---------------------------------------------------------------- *
   * GET /runs/:runId/commands?after=<seq>&limit=<n>
   * ---------------------------------------------------------------- */
  app.get(`${API_BASE_PATH}/runs/:runId/commands`, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const authorized = await authorize(ctx, request, reply, runId);
    if (!authorized) return reply;

    const query = listCommandsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return fail(reply, request, 'INVALID_INPUT', 'after and limit must be non-negative integers.', {
        recovery: `limit is at most ${API_LIMITS.maxCommandPageSize}.`,
      });
    }

    const commands = await ctx.repository.listCommands(runId, query.data.after, query.data.limit);
    const lastReturned = commands.length > 0 ? commands[commands.length - 1]!.seq : query.data.after;

    const data: ListCommandsData = {
      runId,
      commands,
      lastSeq: authorized.run.lastSeq,
      stateHash: authorized.run.stateHash,
      hasMore: lastReturned < authorized.run.lastSeq,
    };
    return succeed(reply, request, data);
  });

  /* ---------------------------------------------------------------- *
   * POST /runs/:runId/commands
   * ---------------------------------------------------------------- */
  app.post(`${API_BASE_PATH}/runs/:runId/commands`, async (request, reply) => {
    const { runId } = request.params as { runId: string };

    const limit = ctx.rateLimiter.check(
      'command_append',
      clientKey(request),
      ctx.config.rateLimits.commandAppend,
    );
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      return fail(reply, request, 'RATE_LIMITED', 'Too many commands appended from this client.', {
        recovery: `Wait ${limit.retryAfterSec} seconds. Commands are queued locally meanwhile.`,
      });
    }

    const authorized = await authorize(ctx, request, reply, runId);
    if (!authorized) return reply;

    const parsed = appendCommandRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, request, 'INVALID_INPUT', 'The command did not match the schema.', {
        recovery: 'Check seq, kind, origin, stateVersionBefore/After and clientStateHash.',
      });
    }
    const submission = parsed.data;

    if (!withinCommandSizeLimit(submission)) {
      return fail(reply, request, 'INVALID_INPUT', 'This command carries too much data.', {
        recovery: `A single command is limited to ${API_LIMITS.maxCommandJsonBytes} bytes.`,
      });
    }

    return applyBatch(ctx, request, reply, authorized.run, [submission], 'single');
  });

  /* ---------------------------------------------------------------- *
   * POST /runs/:runId/commands/batch
   * ---------------------------------------------------------------- */
  app.post(`${API_BASE_PATH}/runs/:runId/commands/batch`, async (request, reply) => {
    const { runId } = request.params as { runId: string };

    const limit = ctx.rateLimiter.check(
      'command_append',
      clientKey(request),
      ctx.config.rateLimits.commandAppend,
    );
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSec));
      return fail(reply, request, 'RATE_LIMITED', 'Too many commands appended from this client.', {
        recovery: `Wait ${limit.retryAfterSec} seconds. Commands are queued locally meanwhile.`,
      });
    }

    const authorized = await authorize(ctx, request, reply, runId);
    if (!authorized) return reply;

    const parsed = appendBatchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, request, 'INVALID_INPUT', 'The batch did not match the schema.', {
        recovery: `Send between 1 and ${API_LIMITS.maxBatchCommands} commands.`,
      });
    }

    const commands = parsed.data.commands;
    for (const [index, command] of commands.entries()) {
      if (command.seq !== commands[0]!.seq + index) {
        return fail(reply, request, 'INVALID_INPUT', 'A batch must be contiguous in seq.', {
          recovery: 'Upload the missing suffix in order, without gaps.',
        });
      }
      if (!withinCommandSizeLimit(command)) {
        return fail(reply, request, 'INVALID_INPUT', 'A command in this batch carries too much data.');
      }
    }

    return applyBatch(ctx, request, reply, authorized.run, commands, 'batch');
  });
}

/* ------------------------------------------------------------------ *
 * The one write path
 * ------------------------------------------------------------------ */

/**
 * Verify-then-persist, used by both append routes.
 *
 * Ordering matters and is worth reading in sequence:
 *
 *  1. transport idempotency — an already-acknowledged append returns its
 *     ORIGINAL acknowledgement and applies nothing;
 *  2. sequence contiguity — a skipped seq is a `CONFLICT` carrying `expectedSeq`;
 *  3. replay of the stored history with the shared engine;
 *  4. re-execution and comparison of every submitted command;
 *  5. persistence, transactional, only if every step above held.
 *
 * Steps 3–4 are where the contract's "the server verifies, it does not invent"
 * lives. On divergence the function returns `REPLAY_MISMATCH` and returns
 * *before* touching the repository, so the run does not advance.
 */
async function applyBatch(
  ctx: AppContext,
  request: Request,
  reply: Reply,
  run: RunRecord,
  submissions: readonly AppendCommandRequest[],
  mode: 'single' | 'batch',
) {
  const first = submissions[0]!;

  /* 1. Transport-level idempotency. */
  if (mode === 'single' && first.idempotencyKey) {
    const existing = await ctx.repository.findCommandByIdempotencyHash(
      run.id,
      hashToken(first.idempotencyKey),
    );
    if (existing) {
      const data: AppendCommandData = {
        runId: run.id,
        seq: existing.seq,
        duplicate: true,
        lastSeq: run.lastSeq,
        stateVersion: run.stateVersion,
        stateHash: run.stateHash,
        status: run.status,
        ending: run.ending,
      };
      return succeed(reply, request, data);
    }
  }

  /* 2. Sequence checks. A replay of an already-stored seq returns the original
   *    acknowledgement; a skipped seq is a conflict naming what was expected. */
  const expectedSeq = run.lastSeq + 1;
  if (first.seq <= run.lastSeq) {
    const data: AppendCommandData = {
      runId: run.id,
      seq: first.seq,
      duplicate: true,
      lastSeq: run.lastSeq,
      stateVersion: run.stateVersion,
      stateHash: run.stateHash,
      status: run.status,
      ending: run.ending,
    };
    if (mode === 'single') return succeed(reply, request, data);
    return fail(reply, request, 'CONFLICT', 'This batch starts before the stored sequence.', {
      expectedSeq,
      recovery: `Upload only the suffix from seq ${expectedSeq}.`,
    });
  }
  if (first.seq !== expectedSeq) {
    return fail(reply, request, 'CONFLICT', 'A command sequence was skipped.', {
      expectedSeq,
      recovery: `Send seq ${expectedSeq} next. Fetch the log with GET .../commands?after= to resynchronise.`,
    });
  }

  if (run.status === 'closed') {
    return fail(reply, request, 'CONFLICT', 'This run is already closed.', {
      expectedSeq: run.lastSeq,
      recovery: 'Start a new run to keep playing.',
    });
  }

  /* 3–4. Replay the stored history, then re-execute and compare. */
  const history = await ctx.repository.allCommands(run.id);
  let priorContext: GameContext;
  try {
    priorContext = replayHistory(history);
  } catch {
    ctx.logger.log('error', 'replay_failed', {
      requestId: request.cycaseRequestId,
      run: runIdLogHash(run.id),
      storedCommands: history.length,
    });
    return fail(reply, request, 'INTERNAL', 'The stored run could not be replayed.', {
      recovery: 'Keep playing locally and export the run if you need the record.',
    });
  }

  const verification = verifyBatch(priorContext, submissions);
  if (!verification.ok) {
    const failure = verification.failure!;
    ctx.logger.log('warn', 'replay_mismatch', {
      requestId: request.cycaseRequestId,
      run: runIdLogHash(run.id),
      seq: submissions[verification.failedIndex ?? 0]?.seq,
      kind: submissions[verification.failedIndex ?? 0]?.kind,
      reason: failure.reason,
      detail: failure.detail,
      replayMs: Math.round(failure.durationMs * 100) / 100,
    });
    return fail(
      reply,
      request,
      'REPLAY_MISMATCH',
      'This command does not match a deterministic replay of the stored run.',
      {
        recovery:
          'The run was not advanced. Keep playing locally; sync is frozen until the histories are reviewed.',
      },
    );
  }

  const verifiedContext = verification.context!;
  const stateHash = verification.stateHash ?? signatureHash(verifiedContext);

  /* 5. Persist. Transactional: either the whole contiguous batch lands or none. */
  const createdAt = new Date(ctx.now()).toISOString();
  const rows: NewCommand[] = submissions.map((submission) => ({
    runId: run.id,
    seq: submission.seq,
    kind: submission.kind,
    origin: submission.origin,
    input: submission.input,
    incidentAtSec: submission.incidentAtSec,
    stateVersionBefore: submission.stateVersionBefore,
    stateVersionAfter: submission.stateVersionAfter,
    result: submission.result,
    idempotencyKeyHash: submission.idempotencyKey ? hashToken(submission.idempotencyKey) : null,
    createdAt,
  }));

  const lastSeq = submissions[submissions.length - 1]!.seq;
  const closed = verifiedContext.caseClosed;

  try {
    await ctx.repository.appendCommands(run.id, rows, {
      lastSeq,
      stateVersion: verifiedContext.stateVersion,
      stateHash,
      status: closed ? 'closed' : 'active',
      ending: verifiedContext.ending,
      score: closed ? scoreOf(verifiedContext) : null,
      updatedAt: createdAt,
    });
  } catch (error) {
    if (error instanceof SequenceConflictError) {
      return fail(reply, request, 'CONFLICT', 'Another writer advanced this run first.', {
        expectedSeq: error.expectedSeq,
        recovery: `Fetch the log and resend from seq ${error.expectedSeq}.`,
      });
    }
    ctx.logger.log('error', 'persist_failed', {
      requestId: request.cycaseRequestId,
      run: runIdLogHash(run.id),
      seq: first.seq,
      name: (error as Error).name,
    });
    return fail(reply, request, 'INTERNAL', 'The command could not be stored.', {
      recovery: 'It stays queued locally and will be retried. Gameplay is unaffected.',
    });
  }

  ctx.logger.log('info', 'commands_appended', {
    requestId: request.cycaseRequestId,
    run: runIdLogHash(run.id),
    count: submissions.length,
    fromSeq: first.seq,
    toSeq: lastSeq,
    kinds: submissions.map((submission) => submission.kind),
    replayMs: Math.round(verification.durationMs * 100) / 100,
  });

  if (mode === 'single') {
    const data: AppendCommandData = {
      runId: run.id,
      seq: first.seq,
      duplicate: false,
      lastSeq,
      stateVersion: verifiedContext.stateVersion,
      stateHash,
      status: closed ? 'closed' : 'active',
      ending: verifiedContext.ending,
    };
    return succeed(reply, request, data, 201);
  }

  const data: AppendBatchData = {
    runId: run.id,
    accepted: submissions.length,
    duplicates: 0,
    lastSeq,
    stateVersion: verifiedContext.stateVersion,
    stateHash,
    status: closed ? 'closed' : 'active',
    ending: verifiedContext.ending,
  };
  return succeed(reply, request, data, 201);
}
