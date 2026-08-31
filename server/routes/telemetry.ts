import type { FastifyInstance, FastifyRequest } from 'fastify';

import { API_BASE_PATH, type StreamTokenData } from '../../shared/apiContract';
import { telemetryEventsAfter, TELEMETRY_FIXTURE_DURATION_SEC } from '../../shared/telemetryFixture';
import { INCIDENT_START_SEC } from '../../src/game/fixtures/case001';
import { fail, succeed, type AppContext } from '../app';
import {
  formatSseEvent,
  formatSseHeartbeat,
  sequenceFromEventId,
  SSE_HEARTBEAT_MS,
  TelemetrySequencer,
} from '../services/telemetryStream';
import { generateStreamToken, hashToken, parseBearer, verifyToken } from '../services/tokens';

/**
 * Optional SSE telemetry (contract §6).
 *
 * Off by default and gated by `CYCASE_FEATURE_SSE`, because the contract makes
 * it optional and because nothing about finishing Case 001 depends on it. When
 * the flag is off both routes answer `NOT_FOUND` — the same answer an
 * unconfigured deployment gives, so a probe learns nothing.
 *
 * Authorization deliberately uses a *short-lived stream token* rather than the
 * write token: `EventSource` cannot set headers, so the credential ends up in a
 * URL, and §6 forbids putting the persistent write token there. A stream token
 * is minted with the write token, lives for two minutes, and grants read-only
 * access to one run's event stream.
 */

interface StreamGrant {
  runId: string;
  expiresAtMs: number;
}

const STREAM_TOKEN_TTL_MS = 2 * 60 * 1000;

export function registerTelemetryRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Hash → grant. In-process because a stream token outlives neither the run nor a restart. */
  const grants = new Map<string, StreamGrant>();

  const disabled = (request: FastifyRequest, reply: Parameters<typeof fail>[0]) =>
    fail(reply, request, 'NOT_FOUND', 'Telemetry streaming is not enabled on this deployment.', {
      status: 404,
      recovery: 'The deterministic local telemetry adapter runs in the browser and needs no server.',
    });

  /* ---- POST /runs/:runId/stream-token ---- */
  app.post(`${API_BASE_PATH}/runs/:runId/stream-token`, async (request, reply) => {
    if (!ctx.config.features.sseTelemetry) return disabled(request, reply);

    const { runId } = request.params as { runId: string };
    const token = parseBearer(request.headers.authorization);
    const run = await ctx.repository.getRun(runId);
    if (!token || !run || !verifyToken(token, run.writeTokenHash)) {
      return fail(reply, request, 'UNAUTHORIZED', 'This run token is not valid for this run.');
    }

    const streamToken = generateStreamToken();
    const expiresAtMs = ctx.now() + STREAM_TOKEN_TTL_MS;
    grants.set(hashToken(streamToken), { runId, expiresAtMs });

    const data: StreamTokenData = {
      streamToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    return succeed(reply, request, data, 201);
  });

  /* ---- GET /runs/:runId/events ---- */
  app.get(`${API_BASE_PATH}/runs/:runId/events`, async (request, reply) => {
    if (!ctx.config.features.sseTelemetry) return disabled(request, reply);

    const { runId } = request.params as { runId: string };
    const query = request.query as { streamToken?: string; at?: string };
    const presented = query.streamToken ?? '';
    const grant = grants.get(hashToken(presented));

    if (!presented || !grant || grant.runId !== runId || grant.expiresAtMs <= ctx.now()) {
      if (grant && grant.expiresAtMs <= ctx.now()) grants.delete(hashToken(presented));
      return fail(reply, request, 'UNAUTHORIZED', 'This stream token is not valid.', {
        recovery: 'Request a new stream token with the run write token.',
      });
    }

    const resumeFrom = sequenceFromEventId(
      typeof request.headers['last-event-id'] === 'string'
        ? request.headers['last-event-id']
        : undefined,
    );
    const sequencer = new TelemetrySequencer(resumeFrom);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const startedAt = ctx.now();
    let closed = false;

    const push = () => {
      if (closed) return;
      // The scenario clock is derived from wall time since connection, so the
      // stream cannot outrun or lag the fixture it shares with the local adapter.
      const elapsedSec = Math.floor((ctx.now() - startedAt) / 1000);
      const scenarioTimeSec = INCIDENT_START_SEC + elapsedSec;
      const { accepted } = sequencer.accept(
        telemetryEventsAfter(sequencer.sequence, scenarioTimeSec),
      );
      for (const event of accepted) reply.raw.write(formatSseEvent(event));
      if (elapsedSec > TELEMETRY_FIXTURE_DURATION_SEC + 5) {
        stop();
        reply.raw.end();
      }
    };

    const pushTimer = setInterval(push, 1000);
    const heartbeatTimer = setInterval(() => {
      if (!closed) reply.raw.write(formatSseHeartbeat());
    }, SSE_HEARTBEAT_MS);

    function stop() {
      if (closed) return;
      closed = true;
      clearInterval(pushTimer);
      clearInterval(heartbeatTimer);
      ctx.logger.log('info', 'sse_closed', {
        requestId: request.cycaseRequestId,
        lastSequence: sequencer.sequence,
      });
    }

    request.raw.on('close', stop);
    push();

    // Fastify must not also try to send a body for this reply.
    return reply;
  });
}
