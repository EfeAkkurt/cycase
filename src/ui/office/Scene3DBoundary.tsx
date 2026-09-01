import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches anything the 3D office throws on its way onto the screen.
 *
 * Three failures reach here and all three used to end the same way — a blank
 * rectangle where the room should be, with the case still running underneath
 * and no way for the player to know that:
 *
 * - the lazy `import('./Office3D')` rejecting, which is what a dropped
 *   connection or an evicted chunk looks like on a slow network;
 * - a GLB failing to load. `useLoader` throws the fetch error through Suspense,
 *   and an error thrown through Suspense is not caught by the Suspense boundary
 *   — it needs an error boundary or it unmounts the whole tree;
 * - anything in the scene graph throwing during render.
 *
 * Recovery is deliberately *not* attempted here. The case has never lived in
 * the canvas — it lives in the state machine above this component — so the
 * right answer is to say so and hand the player the 2D monitor wall, which is
 * a complete way to finish the case rather than a degraded one.
 *
 * `resetKey` is what lets the player try again: change it and the boundary
 * re-arms, which is how the "Try the 3D office again" control works without a
 * page reload.
 */
export class Scene3DBoundary extends Component<
  {
    children: ReactNode;
    /** Rendered instead of the children once something has thrown. */
    fallback: ReactNode;
    /** Called once per failure, so the office can record why it is in 2D. */
    onError: (error: Error) => void;
    /** Changing this clears the caught error and retries the children. */
    resetKey?: string | number;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey?: string | number }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * Reported to the office, not to the console.
     *
     * `console-hygiene.spec.ts` fails the build on any console error that is
     * not named and justified, and it is right to: a product that logs its own
     * failures and carries on is a product where nobody notices the failure.
     * The office turns this into a visible, screen-reader-announced sentence
     * instead, which is the thing a player can actually act on.
     */
    this.props.onError(error);
    void info;
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
