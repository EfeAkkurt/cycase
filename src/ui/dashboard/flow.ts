import type { GameRuntime } from '../../game/runtime';
import type { ArtifactId, DashboardRoute } from '../../game/types';

/* ------------------------------------------------------------------ *
 * The task and evidence flow — one intent per thing a control can mean
 * ------------------------------------------------------------------ *
 *
 * Three surfaces used to offer "open this record" and three surfaces
 * implemented it differently. The guided card called `inspectArtifact()`, which
 * marks a record read and — for a human caller — does not change destination,
 * so the case advanced while the reader sat on Command looking at a button.
 * The timeline branched on whether the record had already been read, taking one
 * of two different paths. The rail's shortcut inspected first and navigated
 * afterwards. A player therefore got three behaviours from one sentence.
 *
 * There is one behaviour now, and it is the honest one: opening a record is
 * *navigation*. It selects the record and goes to Evidence. Nothing is recorded
 * as read until the inspector has the record on screen, which is what makes
 * "the case cannot pass D2 before you have seen the evidence" a fact about the
 * product rather than a hope about the player.
 */

/**
 * Open one record in the evidence inspector.
 *
 * Deliberately not a command: no `stateVersion`, no score, no entry in the
 * command log. `SELECT_ARTIFACT` before `SET_ROUTE` so the inspector's first
 * render already has its subject and never paints an empty frame.
 */
export function openEvidenceRecord(runtime: GameRuntime, artifactId: ArtifactId): void {
  runtime.send({ type: 'SELECT_ARTIFACT', artifactId });
  runtime.send({ type: 'SET_ROUTE', route: 'evidence' });
}

/** Go to a destination without disturbing which tool or record is selected. */
export function openRoute(runtime: GameRuntime, route: DashboardRoute): void {
  runtime.send({ type: 'SET_ROUTE', route });
}
