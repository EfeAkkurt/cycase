import { useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ *
 * Which surface owns the receipt for the last command
 * ------------------------------------------------------------------ *
 *
 * A receipt belongs beside the control that caused it, and the same command can
 * be issued from two places: the guided card runs the required step, and the
 * destination's own control runs the same operation directly. Both render a
 * receipt, so exactly one of them has to stand down — two would be a duplicated
 * DOM id and a doubled announcement.
 *
 * The rule is ownership by issue: whoever ran the command shows the receipt.
 * The guided card records the sequence number it produced; every anchored
 * receipt at a destination renders only for sequences the card did not claim,
 * which is also what makes an *agent's* call surface at the control it moved
 * rather than in the card the agent never touched.
 *
 * A module-level store rather than context, because the only component that
 * could host a provider for both is the console shell, and this work does not
 * own the shell. `useSyncExternalStore` keeps it a first-class React read.
 */

let claimedSeq: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the guided card immediately after it issues a command. */
export function claimReceipt(seq: number): void {
  if (claimedSeq === seq) return;
  claimedSeq = seq;
  emit();
}

/** Test and restart hook: forget the claim so a new case starts clean. */
export function resetReceiptClaim(): void {
  if (claimedSeq === null) return;
  claimedSeq = null;
  emit();
}

export function useClaimedReceiptSeq(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => claimedSeq,
    () => null,
  );
}
