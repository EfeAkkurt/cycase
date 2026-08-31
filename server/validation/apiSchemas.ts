/**
 * The server's view of the API schemas.
 *
 * Everything is re-exported from `shared/apiContract.ts` rather than redefined.
 * That is the whole point of the file: the contract requires the schemas to be
 * *shared at the API boundary*, and a second definition on the server — however
 * faithful on the day it is written — is a drift waiting to happen. Anything
 * server-only (validation that needs a repository, a clock or a secret) belongs
 * here instead.
 */

export {
  API_BASE_PATH,
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_LIMITS,
  appendBatchRequestSchema,
  appendCommandRequestSchema,
  commandKindSchema,
  createRunRequestSchema,
  listCommandsQuerySchema,
  originSchema,
  ROUTES,
  runIdSchema,
  stateHashSchema,
  telemetryEventSchema,
  toolResultSchema,
  withinCommandSizeLimit,
} from '../../shared/apiContract';

export type {
  ApiErrorCode,
  ApiFailure,
  ApiResponse,
  ApiSuccess,
  AppendBatchRequest,
  AppendCommandRequest,
  CreateRunRequest,
  PersistedCommand,
  RunStatus,
  TelemetryEvent,
} from '../../shared/apiContract';

export {
  scenarioPlanSchema,
  validateScenarioPlan,
  SCENARIO_PLAN_SCHEMA_VERSION,
  PLAN_LIMITS,
  ALLOWED_PLAN_DOMAINS,
} from '../../shared/scenarioPlan';

export type { ScenarioPlan, PlanValidationReport, PlanViolation } from '../../shared/scenarioPlan';
