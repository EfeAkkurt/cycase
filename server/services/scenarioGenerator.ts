import { ARTIFACT_IDS } from '../../src/game/types';
import {
  validateScenarioPlan,
  type PlanValidationReport,
  type ScenarioVersionStatus,
} from '../../shared/scenarioPlan';

/**
 * Scenario plan intake.
 *
 * **`POST /api/v1/scenarios/generate` is deliberately not implemented.** There
 * is no server-side OpenAI credential in this environment, so a generation
 * route could not be exercised by any test in this repository — and an
 * unexercised route that calls a paid provider with a model-authored payload is
 * exactly the kind of code that ships broken. Contract §6 marks the endpoint
 * optional and flag-gated, so leaving it out is compliant rather than a gap.
 *
 * What *does* ship is everything that makes such a route safe later, because
 * all of it is cheap and testable today:
 *
 * - the typed `ScenarioPlan` schema and its §7 validation gates;
 * - `intakeScenarioPlan`, the server-side path a generated plan would take —
 *   validate, then store as `draft`, never `published`;
 * - the `scenario_versions` table with a database-level immutability trigger.
 *
 * The only piece missing is the provider call itself. When a credential exists,
 * a generator hands its parsed JSON to `intakeScenarioPlan` and nothing else in
 * the security path changes.
 */

export interface ScenarioIntake {
  status: ScenarioVersionStatus;
  report: PlanValidationReport;
}

/**
 * Validates a candidate plan and decides its stored status.
 *
 * A plan never arrives `published`. §7 requires human review before publication,
 * so this function's ceiling is `draft`, and a failed plan is stored `rejected`
 * with its report rather than discarded — a reviewer needs to see what a model
 * tried to write.
 */
export function intakeScenarioPlan(
  candidate: unknown,
  allowedArtifactIds: readonly string[] = ARTIFACT_IDS,
): ScenarioIntake {
  const report = validateScenarioPlan(candidate, { allowedArtifactIds });
  return { status: report.ok ? 'draft' : 'rejected', report };
}

/** True only when a credential *and* the explicit feature flag are both present. */
export function isGenerationAvailable(features: { scenarioGeneration: boolean }): boolean {
  return features.scenarioGeneration;
}
