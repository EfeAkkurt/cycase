import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  contiguousSuffix,
  createIndexedDbQueue,
  createMemoryQueue,
  type OfflineQueue,
} from '../../../src/backend/offlineQueue';
import type { QueuedCommand } from '../../../src/backend/types';

function queued(seq: number): QueuedCommand {
  return {
    seq,
    kind: 'inspect_artifact',
    origin: 'human',
    input: { artifactId: 'art_email_001', stateVersion: seq - 1 },
    incidentAtSec: 11_862 + seq,
    stateVersionBefore: seq - 1,
    stateVersionAfter: seq,
    result: { ok: true, stateVersion: seq },
    clientStateHash: `sha256:${String(seq).padStart(64, '0')}`,
    idempotencyKey: `append.${seq}`,
  };
}

/** The same expectations run against both implementations. */
function behavesLikeAQueue(name: string, make: () => OfflineQueue) {
  describe(name, () => {
    let queue: OfflineQueue;

    beforeEach(async () => {
      queue = make();
      await queue.clear();
    });

    it('returns queued commands in sequence order', async () => {
      await queue.enqueue(queued(3));
      await queue.enqueue(queued(1));
      await queue.enqueue(queued(2));
      expect((await queue.pending()).map((c) => c.seq)).toEqual([1, 2, 3]);
    });

    it('re-enqueueing the same seq overwrites rather than duplicating', async () => {
      await queue.enqueue(queued(1));
      await queue.enqueue({ ...queued(1), incidentAtSec: 99 });
      const pending = await queue.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.incidentAtSec).toBe(99);
    });

    it('acknowledging a seq removes it and everything before it', async () => {
      for (const seq of [1, 2, 3, 4]) await queue.enqueue(queued(seq));
      await queue.acknowledge(2);
      expect((await queue.pending()).map((c) => c.seq)).toEqual([3, 4]);
    });

    it('acknowledging beyond the queue empties it and is idempotent', async () => {
      await queue.enqueue(queued(1));
      await queue.acknowledge(10);
      await queue.acknowledge(10);
      expect(await queue.pending()).toEqual([]);
    });

    it('stores a run handle that carries no token', async () => {
      await queue.setRunHandle({
        runId: 'run_x',
        expiresAt: '2026-09-05T00:00:00.000Z',
        initialStateHash: `sha256:${'0'.repeat(64)}`,
      });
      const handle = await queue.getRunHandle();
      expect(handle?.runId).toBe('run_x');
      expect(JSON.stringify(handle)).not.toMatch(/token/i);
      await queue.setRunHandle(null);
      expect(await queue.getRunHandle()).toBeNull();
    });
  });
}

// §9 requires IndexedDB, not localStorage. `fake-indexeddb` runs the real
// IndexedDB algorithms in Node, so this exercises the transactional path.
behavesLikeAQueue('IndexedDB queue', () => createIndexedDbQueue(new IDBFactory()));
behavesLikeAQueue('memory fallback', () => createMemoryQueue());

describe('IndexedDB persistence', () => {
  it('survives a reopened connection, which localStorage-per-tab would not', async () => {
    const factory = new IDBFactory();
    const first = createIndexedDbQueue(factory);
    await first.enqueue(queued(1));
    await first.enqueue(queued(2));

    // A new queue object over the same factory is what a page reload looks like.
    const second = createIndexedDbQueue(factory);
    expect((await second.pending()).map((c) => c.seq)).toEqual([1, 2]);
  });

  it('falls back to memory when IndexedDB is unavailable, never throwing', async () => {
    const queue = createIndexedDbQueue(undefined);
    await queue.enqueue(queued(1));
    expect(await queue.pending()).toHaveLength(1);
  });
});

describe('contiguous suffix (§9: upload only the missing suffix)', () => {
  it('returns everything from the requested sequence onwards', () => {
    const commands = [1, 2, 3, 4].map(queued);
    expect(contiguousSuffix(commands, 3).map((c) => c.seq)).toEqual([3, 4]);
  });

  it('skips what the server already has', () => {
    const commands = [1, 2, 3].map(queued);
    expect(contiguousSuffix(commands, 4)).toEqual([]);
  });

  it('stops at a gap rather than uploading past it', () => {
    const commands = [1, 2, 5, 6].map(queued);
    expect(contiguousSuffix(commands, 1).map((c) => c.seq)).toEqual([1, 2]);
  });

  it('returns nothing when the suffix does not start where the server needs it', () => {
    const commands = [4, 5].map(queued);
    expect(contiguousSuffix(commands, 2)).toEqual([]);
  });

  it('is order-insensitive about its input', () => {
    const commands = [3, 1, 2].map(queued);
    expect(contiguousSuffix(commands, 1).map((c) => c.seq)).toEqual([1, 2, 3]);
  });
});
