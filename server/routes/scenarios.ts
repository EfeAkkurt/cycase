import type { FastifyInstance } from 'fastify';

import { API_BASE_PATH } from '../../shared/apiContract';
import { fail, type AppContext } from '../app';

/**
 * Scenario routes.
 *
 * `POST /api/v1/scenarios/generate` is registered but always refuses, and that
 * is a deliberate choice over omitting the path entirely: a 404 would be
 * indistinguishable from a routing bug during a demo, whereas this states
 * exactly why the capability is off. See `services/scenarioGenerator.ts` for
 * the reasoning and for the parts of §7 that *are* implemented.
 *
 * Note what the handler does not do: it never reports whether an
 * `OPENAI_API_KEY` is configured. The response is identical with and without a
 * credential, so this endpoint cannot be used to probe the server's secrets.
 */
export function registerScenarioRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(`${API_BASE_PATH}/scenarios/generate`, async (request, reply) => {
    ctx.logger.log('info', 'scenario_generation_refused', {
      requestId: request.cycaseRequestId,
    });
    return fail(
      reply,
      request,
      'NOT_FOUND',
      'Scenario generation is not enabled on this deployment.',
      {
        status: 404,
        recovery: 'Case 001 ships as a deterministic template and needs no generation.',
      },
    );
  });
}
