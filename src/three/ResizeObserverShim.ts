/**
 * A ResizeObserver-shaped observer that measures immediately.
 *
 * React Three Fiber only creates its WebGL root once the element it measures
 * reports a non-zero size, and it learns that size exclusively from a
 * ResizeObserver callback. In environments where those callbacks are throttled,
 * deferred or suppressed — embedded webviews, backgrounded or occluded tabs,
 * some automation surfaces — the callback never arrives, the canvas stays at
 * its intrinsic 300x150, and the scene renders as a black void with no error
 * anywhere. That failure is silent and very hard to read from the outside.
 *
 * This wrapper keeps the native observer when it works and adds two things it
 * cannot rely on: a synchronous first measurement, and a fallback poll that
 * only runs while the native observer has produced nothing.
 *
 * It is passed to R3F through `resize={{ polyfill: ResizeObserverShim }}`.
 */

type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const POLL_MS = 250;

function entryFor(target: Element): ResizeObserverEntry {
  const rect = target.getBoundingClientRect();
  const box = { inlineSize: rect.width, blockSize: rect.height };
  return {
    target,
    contentRect: rect as DOMRectReadOnly,
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  } as unknown as ResizeObserverEntry;
}

export class ResizeObserverShim {
  private readonly callback: Callback;
  private readonly targets = new Set<Element>();
  private readonly sizes = new WeakMap<Element, string>();
  private native: ResizeObserver | null = null;
  private nativeFired = false;
  private pollTimer: number | undefined;

  constructor(callback: Callback) {
    this.callback = callback;

    if (typeof ResizeObserver === 'function') {
      this.native = new ResizeObserver((entries, observer) => {
        this.nativeFired = true;
        this.stopPolling();
        for (const entry of entries) this.remember(entry.target);
        callback(entries, observer);
      });
    }
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    this.targets.add(target);
    this.native?.observe(target, options);

    // The measurement R3F actually needs, available on the same tick.
    this.emit([target]);
    this.startPolling();
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
    this.native?.unobserve(target);
    if (this.targets.size === 0) this.stopPolling();
  }

  disconnect(): void {
    this.targets.clear();
    this.native?.disconnect();
    this.stopPolling();
  }

  private remember(target: Element): void {
    const rect = target.getBoundingClientRect();
    this.sizes.set(target, `${rect.width}x${rect.height}`);
  }

  private emit(targets: Element[]): void {
    const changed = targets.filter((target) => {
      const rect = target.getBoundingClientRect();
      const key = `${rect.width}x${rect.height}`;
      if (this.sizes.get(target) === key) return false;
      this.sizes.set(target, key);
      return true;
    });

    if (changed.length === 0) return;
    this.callback(
      changed.map(entryFor),
      this as unknown as ResizeObserver,
    );
  }

  private startPolling(): void {
    if (this.pollTimer !== undefined) return;
    this.pollTimer = window.setInterval(() => {
      // Once the native observer has proved it works, stand down.
      if (this.nativeFired) {
        this.stopPolling();
        return;
      }
      this.emit([...this.targets]);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
