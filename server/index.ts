import { buildServer } from './app';
import { loadConfig } from './config';
import { InMemoryRunRepository, type RunRepository } from './persistence/repository';
import { createPostgresPool, PostgresRunRepository } from './persistence/postgresRepository';
import { createLogger } from './services/logRedaction';

/**
 * Process entry point.
 *
 * `DATABASE_URL` selects PostgreSQL; without it the service runs on the
 * in-memory repository, which is correct for local development and for the
 * integration suite but loses every run on restart. The startup log says which
 * one is active, because "why did my run disappear" should be answerable from
 * the first line of the log.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();

  let repository: RunRepository;
  if (config.databaseUrl) {
    const pool = await createPostgresPool(config.databaseUrl);
    repository = new PostgresRunRepository(pool);
    logger.log('info', 'persistence_selected', { driver: 'postgres' });
  } else {
    repository = new InMemoryRunRepository();
    logger.log('warn', 'persistence_selected', {
      driver: 'memory',
      note: 'runs are lost on restart; set DATABASE_URL for durable storage',
    });
  }

  const app = buildServer({ config, repository, logger });

  // §6: anonymous runs expire after seven days. Retention is enforced by a
  // sweep as well as by the expiry check on every authorised request, so an
  // abandoned run is deleted rather than merely refused.
  const purgeTimer = setInterval(
    () => {
      void repository
        .purgeExpired(new Date().toISOString())
        .then((removed) => {
          if (removed > 0) logger.log('info', 'runs_purged', { removed });
        })
        .catch(() => logger.log('warn', 'runs_purge_failed'));
    },
    60 * 60 * 1000,
  );
  purgeTimer.unref();

  await app.listen({ host: config.host, port: config.port });
  logger.log('info', 'listening', {
    host: config.host,
    port: config.port,
    sse: config.features.sseTelemetry,
    scenarioGeneration: config.features.scenarioGeneration,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  // Startup is the one place a raw error is useful, and it never reaches a client.
  process.stderr.write(`cycase-server failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
