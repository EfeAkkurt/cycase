import type { FastifyInstance } from 'fastify';

import { ROUTES, type HealthData } from '../../shared/apiContract';
import { SCENARIO_PLAN_SCHEMA_VERSION } from '../../shared/scenarioPlan';
import { succeed, type AppContext } from '../app';

/**
 * `GET /api/v1/health` — public readiness (contract §6).
 *
 * Two rules from the contract are visible here:
 *
 * - 503 when a dependency *required for persistence* is unavailable, so a
 *   deploy check fails loudly rather than accepting commands it cannot store.
 * - Optional OpenAI generation must never make gameplay health fail, so the
 *   generation feature flag is reported nowhere in this payload and its absence
 *   changes nothing about `status`.
 */
export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(ROUTES.health, async (request, reply) => {
    const databaseReady = await ctx.repository.ping().catch(() => false);

    const data: HealthData = {
      status: databaseReady ? 'ready' : 'degraded',
      version: ctx.config.version,
      database: databaseReady ? 'ready' : 'unavailable',
      scenarioSchemaVersion: SCENARIO_PLAN_SCHEMA_VERSION,
    };

    return succeed(reply, request, data, databaseReady ? 200 : 503);
  });
}
