import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../../server/app';
import { InMemoryRunRepository } from '../../../server/persistence/repository';
import { createSilentLogger } from '../../../server/services/logRedaction';
import { replayHistory, signatureHash } from '../../../server/services/replayVerifier';
import type { ApiSuccess, CreateRunData, PersistedCommand } from '../../../shared/apiContract';
import { PERFECT_RUN, playRun } from '../helpers/run';

const PERFECT_RUN_LENGTH = PERFECT_RUN.length;

/**
 * The §12 performance targets, measured rather than inferred.
 *
 * A real listener over a real socket, not `app.inject`: injection skips the
 * HTTP parser and the event loop's socket handling, which is precisely the part
 * a latency budget is about. The numbers are printed so a reviewer can read the
 * measured p95 next to the target instead of taking a green tick on faith.
 *
 * Caveats worth stating rather than hiding: this runs against the in-memory
 * repository, so the figures isolate verification and framework cost and
 * exclude database round-trips; and one developer machine is not a deployment.
 * §12 asks for both local and deployed measurement — this is the local half.
 */

interface Measurement {
  label: string;
  target: number;
  samples: number[];
}

const results: Measurement[] = [];

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function record(label: string, target: number, samples: number[]): number {
  results.push({ label, target, samples });
  return percentile(samples, 95);
}

describe('performance targets (§12)', () => {
  let baseUrl = '';
  let app: ReturnType<typeof buildServer>;
  const repository = new InMemoryRunRepository();

  beforeAll(async () => {
    app = buildServer({
      repository,
      logger: createSilentLogger(),
      config: {
        quiet: true,
        version: 'load-test',
        // A deployment with origin enforcement on and an empty allowlist now
        // fails closed, because that combination silently rejected every browser
        // write while accepting every scripted one. The load harness is a
        // scripted client, so it configures an allowlist like a real deployment.
        corsAllowlist: ['https://cycase.example'],
        // Rate limits are a security control, not a throughput control; a load
        // measurement that spends its samples on 429s measures nothing.
        rateLimits: {
          runCreate: { limit: 1_000_000, windowMs: 60_000 },
          commandAppend: { limit: 1_000_000, windowMs: 60_000 },
          scenarioGenerate: { limit: 10, windowMs: 60_000 },
        },
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();

    const lines = [
      '',
      'CYCASE backend — measured latency (local, in-memory repository)',
      '  metric                            p50        p95      target   verdict',
    ];
    for (const measurement of results) {
      const p50 = percentile(measurement.samples, 50);
      const p95 = percentile(measurement.samples, 95);
      lines.push(
        `  ${measurement.label.padEnd(30)} ${p50.toFixed(2).padStart(7)}ms ${p95
          .toFixed(2)
          .padStart(7)}ms ${`${measurement.target}ms`.padStart(9)}   ${
          p95 < measurement.target ? 'PASS' : 'FAIL'
        }`,
      );
    }
     
    console.log(lines.join('\n'));
  });

  async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ApiSuccess<T>;
    if (!payload.ok) throw new Error(`unexpected failure: ${JSON.stringify(payload)}`);
    return payload.data;
  }

  async function createRun(): Promise<CreateRunData> {
    return post<CreateRunData>('/api/v1/runs', {
      scenarioId: 'CASE-001',
      scenarioVersion: 1,
      clientBuild: 'load-test',
    });
  }

  it('health p95 < 100 ms', async () => {
    // Warm up so JIT and first-connection cost do not land in the sample.
    for (let i = 0; i < 20; i += 1) await fetch(`${baseUrl}/api/v1/health`);

    const samples: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const start = performance.now();
      const response = await fetch(`${baseUrl}/api/v1/health`);
      await response.json();
      samples.push(performance.now() - start);
    }

    const p95 = record('health', 100, samples);
    expect(p95).toBeLessThan(100);
  });

  it('run creation p95 < 300 ms', async () => {
    for (let i = 0; i < 10; i += 1) await createRun();

    const samples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const start = performance.now();
      await createRun();
      samples.push(performance.now() - start);
    }

    const p95 = record('run creation', 300, samples);
    expect(p95).toBeLessThan(300);
  });

  it('single command verification p95 < 250 ms', async () => {
    const played = playRun();
    const samples: number[] = [];

    // Each iteration appends one command to a *fresh* run at the same depth, so
    // the sample measures verification of one command rather than of a run that
    // grows longer with every iteration.
    for (let i = 0; i < 60; i += 1) {
      const run = await createRun();
      const start = performance.now();
      await post(`/api/v1/runs/${run.runId}/commands`, played.submissions[0]!, run.writeToken);
      samples.push(performance.now() - start);
    }

    const p95 = record('single command append', 250, samples);
    expect(p95).toBeLessThan(250);
  });

  it('batch of 50 commands p95 < 1 s', async () => {
    // A genuine 50-command batch, not a scaled estimate. The perfect run is 17
    // commands, so it is preceded by 33 `request_hint` calls — those are real
    // logged commands that the engine replays and the verifier checks, and they
    // do not bump `stateVersion`, so the run still reaches the same ending.
    const batch = playRun([
      ...Array.from({ length: 50 - PERFECT_RUN_LENGTH }, () => ({
        kind: 'request_hint' as const,
        input: { topic: 'evidence' },
      })),
      ...PERFECT_RUN,
    ]).submissions;
    expect(batch).toHaveLength(50);

    const samples: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const run = await createRun();
      const start = performance.now();
      await post(`/api/v1/runs/${run.runId}/commands/batch`, { commands: batch }, run.writeToken);
      samples.push(performance.now() - start);
    }

    const p95 = record('batch of 50 commands', 1000, samples);
    expect(p95).toBeLessThan(1000);
  });

  it('server-side replay of 100 commands < 500 ms', async () => {
    // A real 100-command history: the full case padded with hint requests, all
    // of which the engine accepts. Padding with commands the engine would
    // *reject* would make the measurement flattering, since a rejection exits
    // before dispatch.
    const played = playRun([
      ...Array.from({ length: 100 - PERFECT_RUN_LENGTH }, () => ({
        kind: 'request_hint' as const,
        input: { topic: 'containment' },
      })),
      ...PERFECT_RUN,
    ]);
    const rows: PersistedCommand[] = played.submissions.map((submission) => ({
      seq: submission.seq,
      kind: submission.kind,
      origin: submission.origin,
      input: submission.input,
      incidentAtSec: submission.incidentAtSec,
      stateVersionBefore: submission.stateVersionBefore,
      stateVersionAfter: submission.stateVersionAfter,
      result: submission.result,
      createdAt: '2026-08-29T00:00:00.000Z',
    }));
    expect(rows).toHaveLength(100);

    for (let i = 0; i < 5; i += 1) replayHistory(rows);

    const samples: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const start = performance.now();
      const context = replayHistory(rows);
      signatureHash(context);
      samples.push(performance.now() - start);
    }

    const p95 = record('replay of 100 commands', 500, samples);
    expect(p95).toBeLessThan(500);
  });

  it('a full run round-trips under load without a single mismatch', async () => {
    const played = playRun();
    const run = await createRun();
    for (const submission of played.submissions) {
      await post(`/api/v1/runs/${run.runId}/commands`, submission, run.writeToken);
    }
    const stored = await repository.allCommands(run.runId);
    expect(signatureHash(replayHistory(stored))).toBe(
      played.submissions[played.submissions.length - 1]!.clientStateHash,
    );
  });
});
