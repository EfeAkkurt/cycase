import type { QueuedCommand, RunHandle } from './types';

/**
 * The offline command queue (contract §9).
 *
 * IndexedDB, not `localStorage`, and the contract is explicit about it. Three
 * reasons make it the right call rather than a preference: `localStorage` is
 * synchronous and blocks the render thread on a store the size of a full case
 * log; it is capped around 5 MB with no structured-clone support, so every
 * command would have to be re-serialised; and it offers no transaction, so a
 * tab closed mid-write can leave a half-written array. IndexedDB gives an
 * atomic transaction per flush, which is what "uploads the missing suffix
 * exactly once" needs.
 *
 * The write token is never stored here. §9: "Never store the write token in
 * logs, analytics or a persisted command payload." It lives in `sessionStorage`
 * for the tab's lifetime and nowhere else.
 */

const DB_NAME = 'cycase-run-sync';
const DB_VERSION = 1;
const COMMAND_STORE = 'queued-commands';
const META_STORE = 'run-meta';

export interface OfflineQueue {
  /** Adds a command. Re-adding the same seq overwrites rather than duplicating. */
  enqueue(command: QueuedCommand): Promise<void>;
  /** Everything still unacknowledged, ordered by seq. */
  pending(): Promise<QueuedCommand[]>;
  /** Removes every command at or below `seq`. Called once the server acknowledges. */
  acknowledge(seq: number): Promise<void>;
  setRunHandle(handle: RunHandle | null): Promise<void>;
  getRunHandle(): Promise<RunHandle | null>;
  clear(): Promise<void>;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COMMAND_STORE)) {
        // Keyed by seq: the queue is a sparse view of the command log, and the
        // log's own numbering is the only key that can never collide.
        db.createObjectStore(COMMAND_STORE, { keyPath: 'seq' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createIndexedDbQueue(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): OfflineQueue {
  if (!factory) return createMemoryQueue();

  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    dbPromise ??= openDatabase(factory);
    return dbPromise;
  };

  const withStore = async <T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> => {
    const database = await db();
    const tx = database.transaction(store, mode);
    const result = await fn(tx.objectStore(store));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  };

  return {
    async enqueue(command) {
      await withStore(COMMAND_STORE, 'readwrite', (store) => {
        store.put(command);
      });
    },

    async pending() {
      const rows = await withStore(COMMAND_STORE, 'readonly', (store) =>
        promisify(store.getAll() as IDBRequest<QueuedCommand[]>),
      );
      return rows.sort((a, b) => a.seq - b.seq);
    },

    async acknowledge(seq) {
      await withStore(COMMAND_STORE, 'readwrite', async (store) => {
        const keys = await promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>);
        for (const key of keys) {
          if (typeof key === 'number' && key <= seq) store.delete(key);
        }
      });
    },

    async setRunHandle(handle) {
      await withStore(META_STORE, 'readwrite', (store) => {
        if (handle) store.put(handle, 'run');
        else store.delete('run');
      });
    },

    async getRunHandle() {
      const value = await withStore(META_STORE, 'readonly', (store) =>
        promisify(store.get('run') as IDBRequest<RunHandle | undefined>),
      );
      return value ?? null;
    },

    async clear() {
      await withStore(COMMAND_STORE, 'readwrite', (store) => {
        store.clear();
      });
      await withStore(META_STORE, 'readwrite', (store) => {
        store.clear();
      });
    },
  };
}

/**
 * Non-persistent fallback for environments without IndexedDB (server-side
 * rendering, a locked-down browser profile, a unit test that does not need
 * persistence). Gameplay must never depend on the queue existing.
 */
export function createMemoryQueue(): OfflineQueue {
  const commands = new Map<number, QueuedCommand>();
  let handle: RunHandle | null = null;

  return {
    async enqueue(command) {
      commands.set(command.seq, command);
    },
    async pending() {
      return [...commands.values()].sort((a, b) => a.seq - b.seq);
    },
    async acknowledge(seq) {
      for (const key of [...commands.keys()]) {
        if (key <= seq) commands.delete(key);
      }
    },
    async setRunHandle(next) {
      handle = next;
    },
    async getRunHandle() {
      return handle;
    },
    async clear() {
      commands.clear();
      handle = null;
    },
  };
}

/**
 * Picks the contiguous suffix that starts at `fromSeq`.
 *
 * §9: "upload only the contiguous missing suffix". A gap means an earlier
 * command was lost locally, and uploading past the gap would ask the server to
 * verify a replay it cannot reconstruct — so the upload stops at the gap and
 * lets the mismatch surface as a review, not as a corrupted history.
 */
export function contiguousSuffix(
  commands: readonly QueuedCommand[],
  fromSeq: number,
): QueuedCommand[] {
  const ordered = [...commands].sort((a, b) => a.seq - b.seq);
  const suffix: QueuedCommand[] = [];
  let expected = fromSeq;

  for (const command of ordered) {
    if (command.seq < expected) continue;
    if (command.seq !== expected) break;
    suffix.push(command);
    expected += 1;
  }

  return suffix;
}
