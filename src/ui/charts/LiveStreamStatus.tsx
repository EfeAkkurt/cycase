import { useStableGame } from '../../app/gameContext';
import { formatAge, latestBucket, streamPulse } from '../../game/live';
import type { GameContext } from '../../game/types';
import { t } from '../../i18n';
import { StatusDot } from '../primitives';

/**
 * Full mode wants every tick: the counters are the point.
 *
 * Compact mode wants only the two things it draws — which bucket it is in, and
 * whether the feed is paused. Three of these ride the office monitors inside a
 * frame budget, and waking them once a second to re-render text that has not
 * changed is work the scene should not be asked to do.
 */
const everyTick = () => false;

const everyBucket = (previous: GameContext, next: GameContext) =>
  latestBucket(previous) === latestBucket(next) && previous.paused === next.paused;

/**
 * The live edge of the event stream: what it is, when it last moved, and when
 * it moves next.
 *
 * A chart whose points arrive every thirty seconds looks broken for
 * twenty-nine of them. This is the label that fixes that — not by animating
 * the data, which would be a lie, but by saying out loud what the data is
 * doing. Two counters read against each other, "updated 12s ago" and "next in
 * 18s", so a reader can see the stream is alive without a single fabricated
 * value.
 *
 * Three properties are deliberate:
 *
 * - **It subscribes on its own.** The tick re-renders this component and
 *   nothing above it, so the chart's own props change only when a bucket
 *   lands. That is what keeps Recharts from re-animating once a second.
 * - **Pause is a state, not a hiding place.** `streamPulse` is derived from
 *   the incident clock, which `SET_PAUSED` stops. There is no wall clock here
 *   to keep running behind a frozen chart.
 * - **The announcement is a sentence and it is rare.** The visible counters are
 *   plain text; only the `role="status"` copy is announced, and it is written
 *   so that it changes on pause and resume rather than every second. A live
 *   region reading a countdown is unusable.
 */
export function LiveStreamStatus({ compact = false }: { compact?: boolean }) {
  const pulse = streamPulse(useStableGame(compact ? everyBucket : everyTick));

  const label = pulse.frozen
    ? t('stream.frozen', { seconds: pulse.bucketSeconds })
    : t('stream.live', { seconds: pulse.bucketSeconds });

  /*
   * Full mode gets the two counters reading against each other — "updated 12s
   * ago · next in 18s" — which is what makes a stream that appends every thirty
   * seconds legible as alive rather than stuck.
   *
   * Compact mode gets neither, and that is measured rather than assumed. The
   * office legend is 310 px wide and already carries two series keys; the chip
   * plus a readout comes to 326 px and wraps to a second line, which costs a
   * monitor panel more than a clock is worth at that distance. The animated dot
   * carries liveness, the label carries the cadence, and the marked edge on the
   * chart itself carries the newest sample.
   */
  const readout = pulse.frozen
    ? t('stream.frozen_at', { clock: pulse.at.slice(0, 5) })
    : `${t('stream.age', { age: formatAge(pulse.ageSec) })} · ${t('stream.next', {
        seconds: pulse.nextInSec,
      })}`;

  /*
   * The live sentence deliberately carries no reading. A polite region is
   * announced whenever its text changes, so a sentence containing the current
   * numbers would be recited every bucket for the length of the case — the
   * stream of digits an announcement exists to replace. Constant text is
   * announced once and then stays quiet.
   *
   * The paused sentence may carry its reading: a stopped clock does not change
   * it, so it is announced exactly once, at the moment the operator asks the
   * question it answers.
   */
  const sentence = pulse.frozen
    ? t('stream.status.frozen', {
        clock: pulse.at,
        total: pulse.total,
        anomalous: pulse.anomalous,
      })
    : t('stream.status.live', { seconds: pulse.bucketSeconds });

  return (
    // `data-frozen` carries the state for the browser gates, which assert that
    // a paused stream stops rather than merely stops being drawn.
    <span className="stream-live" data-frozen={pulse.frozen ? 'true' : undefined}>
      {/*
       * Keyed on the bucket index, which is the whole mechanism. React remounts
       * this span exactly when a sample lands, replaying a one-shot CSS
       * animation — never on a re-render, and never while paused, because a
       * paused clock cannot cross a boundary. No timer, no state, nothing to
       * leak.
       */}
      <span key={pulse.bucket} className="stream-live__mark">
        <StatusDot tone={pulse.frozen ? 'warning' : 'success'} />
      </span>
      <span className="stream-live__label">{label}</span>
      {/* Frozen still shows its readout in compact: "Paused" without saying
          what it froze at is the one case where the clock is load-bearing. */}
      {compact && !pulse.frozen ? null : (
        <span className="stream-live__readout mono">{readout}</span>
      )}

      {/*
       * One region, in full mode only. The office draws three of these panels
       * on its monitors and three polite regions announcing the same stream
       * would collide with each other and with the provider's own.
       */}
      {compact ? null : (
        <span className="sr-only" role="status">
          {sentence}
        </span>
      )}
    </span>
  );
}
