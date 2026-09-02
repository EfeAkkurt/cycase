import type { ReactNode } from 'react';

/**
 * A block the reader opens when they want it.
 *
 * Built on native `<details>`, and the reason is not brevity. A `<details>` is
 * keyboard operable and announced as expandable without any ARIA of ours; it
 * still works if the script that would have toggled it never runs; and — the
 * property that actually decided it — the browser's own find-in-page opens a
 * closed one to reveal a match inside it. A `useState` disclosure hides its
 * contents from Ctrl-F, which on a page of prerequisites and effect diffs is
 * the difference between "collapsed" and "lost".
 *
 * `defaultOpen` rather than `open`: this is an uncontrolled component on
 * purpose. The whole point of the respond playbook's restructure is that the
 * reader decides what is expanded, and a controlled `open` prop would let a
 * re-render — a clock tick, a state version bump — close a panel someone was
 * reading. React only supplies the initial state; the browser owns it after
 * that.
 *
 * It lives here rather than in `ui/primitives` because `primitives` is outside
 * this phase's file ownership. If it earns a second consumer outside the SOC
 * tools it should move there.
 */
export function Disclosure({
  summary,
  count,
  id,
  defaultOpen = false,
  children,
}: {
  /** The always-visible label. Say what is inside, not "Details". */
  summary: string;
  /** Shown right-aligned in the summary — how much is in there, before opening. */
  count?: string;
  id?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" id={id} open={defaultOpen}>
      <summary>
        <span className="disclosure__caret" aria-hidden="true" />
        {summary}
        {count === undefined ? null : <span className="disclosure__count">{count}</span>}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
