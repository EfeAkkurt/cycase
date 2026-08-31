import { useSyncExternalStore } from 'react';

import {
  RUNTIME_MODE_LABEL,
  SYNC_REVIEW_LABEL,
  type RuntimeMode,
  type RuntimeStatus,
  type SyncState,
} from './types';

/**
 * The runtime-mode store (contract §5).
 *
 * A standalone observable rather than React context, for one specific reason:
 * the indicator this feeds lives in `src/ui/dashboard/` and `src/ui/office/`,
 * which another pass owns. Exposing the mode as a store plus a hook means that
 * pass adds one import and one element, and never has to touch the provider
 * tree or thread a prop through the office scene.
 *
 * The default is `local`. Nothing here reaches the network, and constructing
 * the store does not create a client.
 */

const INITIAL: RuntimeStatus = {
  mode: 'local',
  label: RUNTIME_MODE_LABEL.local,
  sync: 'idle',
  queuedCommands: 0,
  lastAcknowledgedSeq: 0,
  reviewReason: null,
};

export class RuntimeModeStore {
  private status: RuntimeStatus = INITIAL;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): RuntimeStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<Omit<RuntimeStatus, 'label'>>): void {
    const next: RuntimeStatus = {
      ...this.status,
      ...patch,
      label: RUNTIME_MODE_LABEL[patch.mode ?? this.status.mode],
    };
    if (
      next.mode === this.status.mode &&
      next.sync === this.status.sync &&
      next.queuedCommands === this.status.queuedCommands &&
      next.lastAcknowledgedSeq === this.status.lastAcknowledgedSeq &&
      next.reviewReason === this.status.reviewReason
    ) {
      return;
    }
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  setMode(mode: RuntimeMode): void {
    this.set({ mode });
  }

  setSync(sync: SyncState): void {
    this.set({ sync });
  }

  /** §9: freeze sync, keep local gameplay running, surface the review string. */
  freezeForReview(reason: string): void {
    this.set({ sync: 'needs-review', reviewReason: reason });
  }

  reset(): void {
    this.status = INITIAL;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The process-wide store.
 *
 * A module singleton is right here because there is exactly one page, one game
 * runtime and one backend connection per tab; a per-tree instance would let two
 * indicators disagree about whether the run is connected.
 */
export const runtimeModeStore = new RuntimeModeStore();

/** Subscribes a component to the current runtime mode and sync health. */
export function useRuntimeStatus(store: RuntimeModeStore = runtimeModeStore): RuntimeStatus {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Just the mode, for a component that only renders the badge. */
export function useRuntimeMode(store: RuntimeModeStore = runtimeModeStore): RuntimeMode {
  return useRuntimeStatus(store).mode;
}

/**
 * The one sentence the indicator should show.
 *
 * Sync health wins over mode: a connected run whose histories disagree is not
 * "Connected simulation", it is a run that needs a human to look at it.
 */
export function statusLabel(status: RuntimeStatus): string {
  return status.sync === 'needs-review' ? SYNC_REVIEW_LABEL : status.label;
}
