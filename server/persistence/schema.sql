-- CYCASE backend schema — contract §8.
--
-- Applied with:  psql "$DATABASE_URL" -f server/persistence/schema.sql
-- Idempotent: every statement is IF NOT EXISTS, so it doubles as the migration.
--
-- Two invariants live in the database rather than in application code, because
-- an application-level check cannot survive two processes appending at once:
--   * PRIMARY KEY (run_id, seq)               — a sequence cannot be reused
--   * UNIQUE (run_id, idempotency_key_hash)   — a retry cannot apply twice

BEGIN;

CREATE TABLE IF NOT EXISTS runs (
  id                TEXT PRIMARY KEY,
  -- sha256 hex of the write token. The token itself is never stored.
  write_token_hash  CHAR(64)    NOT NULL,
  scenario_id       TEXT        NOT NULL,
  scenario_version  INTEGER     NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'closed', 'expired')),
  last_seq          INTEGER     NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  state_version     INTEGER     NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  state_hash        TEXT        NOT NULL,
  ending            TEXT        NULL CHECK (ending IN ('contained', 'partial') OR ending IS NULL),
  score_json        JSONB       NULL,
  client_build      TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- §6: anonymous runs expire after seven days.
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_expires_at_idx ON runs (expires_at);

CREATE TABLE IF NOT EXISTS run_commands (
  run_id                TEXT        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  -- 1-based position in GameContext.commandLog, NOT GameContext.seq.
  seq                   INTEGER     NOT NULL CHECK (seq >= 1),
  kind                  TEXT        NOT NULL,
  origin                TEXT        NOT NULL CHECK (origin IN ('human', 'agent')),
  input_json            JSONB       NOT NULL,
  result_json           JSONB       NOT NULL,
  incident_at_sec       INTEGER     NOT NULL CHECK (incident_at_sec >= 0),
  state_version_before  INTEGER     NOT NULL CHECK (state_version_before >= 0),
  state_version_after   INTEGER     NOT NULL CHECK (state_version_after >= 0),
  -- sha256 hex of the transport idempotency key, or NULL when none was sent.
  idempotency_key_hash  CHAR(64)    NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS run_commands_idempotency_idx
  ON run_commands (run_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS scenario_versions (
  scenario_id     TEXT        NOT NULL,
  version         INTEGER     NOT NULL,
  schema_version  INTEGER     NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'rejected')),
  plan_json       JSONB       NOT NULL,
  validation_json JSONB       NOT NULL,
  prompt_version  TEXT        NULL,
  model_id        TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ NULL,
  PRIMARY KEY (scenario_id, version)
);

-- §8: published versions are immutable. Enforced in the database so no route,
-- script or psql session can quietly edit a version a human already approved.
CREATE OR REPLACE FUNCTION scenario_versions_block_published_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published scenario versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scenario_versions_immutable ON scenario_versions;
CREATE TRIGGER scenario_versions_immutable
  BEFORE UPDATE OR DELETE ON scenario_versions
  FOR EACH ROW EXECUTE FUNCTION scenario_versions_block_published_update();

CREATE TABLE IF NOT EXISTS telemetry_events (
  run_id            TEXT        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  event_id          TEXT        NOT NULL,
  sequence          INTEGER     NOT NULL CHECK (sequence >= 0),
  scenario_time_sec INTEGER     NOT NULL CHECK (scenario_time_sec >= 0),
  source            TEXT        NOT NULL
                    CHECK (source IN ('identity', 'endpoint', 'network', 'data', 'system')),
  severity          TEXT        NOT NULL
                    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  entity_ids_json   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  kind              TEXT        NOT NULL,
  payload_json      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  emitted_at        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_events_sequence_idx
  ON telemetry_events (run_id, sequence);

COMMIT;
