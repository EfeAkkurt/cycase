# CYCASE Backend Runtime Contract

Status: implementation contract\
Scope: Case 001 vertical slice and later scenario expansion\
Last verified: 2026-08-29

## 1. Outcome

The backend makes a CYCASE run resumable, auditable and optionally streamable without taking control away from the deterministic browser game engine.

The browser must remain able to complete Case 001 with the backend unavailable. The backend is not required for WebMCP discovery and must never become a second gameplay rules engine.

## 2. Locked boundaries

### Browser owns the active run

The existing `GameRuntime` and XState machine remain authoritative while a player is in a case. They own:

- allowed commands and ordering;
- `stateVersion` and idempotency behavior;
- evidence visibility;
- decisions, score, findings and ending;
- immediate UI and office reactions.

### Backend owns durable records and generated content

The backend may own:

- anonymous run creation and expiry;
- append-only command/event persistence;
- deterministic replay verification;
- scenario version storage and schema validation;
- optional SSE delivery of simulated telemetry;
- optional LLM generation of bounded scenario plans and fallback narrative variants;
- operational health, rate limits and audit metrics.

### Backend must never own

- a second list of valid action ids;
- score or ending logic different from `src/game/engine.ts`;
- arbitrary shell, SQL, URL or exploit execution;
- direct mutations that bypass `GameRuntime.execute`;
- a client-visible OpenAI or infrastructure secret;
- hidden gameplay facts that the UI and WebMCP tools cannot read;
- the live narration path. Narration during a run is delivered by the page's own
  `present_guidance` tool. The backend may store a narrative log for replay and
  audit; it never authors, orders or gates a line while a player is in a case.

## 3. Target architecture

```text
                              top-level page
                         +-----------------------+
Human controls ---------->  GameRuntime / XState |<---------- WebMCP tools
                         +-----------+-----------+
                                     |
                                     | append commands and snapshots
                                     v
                         +-----------------------+
                         | Backend API           |
                         | auth/rate validation  |
                         | replay verification   |
                         +-----+-----------+-----+
                               |           |
                        persistence     optional SSE
                               |           |
                               v           v
                         command log   TelemetryAdapter

Optional scenario generation:

OpenAI Responses API -> typed ScenarioPlan -> server validation -> scenario_versions
                                             |
                                             v
                                    deterministic game import
```

No request may mutate the React/XState state directly. A backend event enters through a typed adapter and is converted to an allowlisted game event or display-only telemetry event.

## 4. Recommended repository shape

Do not restructure working frontend files to satisfy this diagram. Add the smallest compatible modules:

```text
server/
  app.ts
  config.ts
  routes/
    health.ts
    runs.ts
    scenarios.ts
    telemetry.ts
  services/
    replayVerifier.ts
    scenarioGenerator.ts
    telemetryStream.ts
  persistence/
    schema.sql
    repository.ts
  validation/
    apiSchemas.ts

src/backend/
  client.ts
  types.ts
  TelemetryAdapter.ts
  LocalScenarioAdapter.ts
  SseTelemetryAdapter.ts

shared/
  scenarioPlan.ts
  apiContract.ts
```

Reference stack when no backend stack already exists:

- TypeScript on Node 20+.
- A small HTTP framework such as Fastify; do not add GraphQL.
- PostgreSQL in hosted environments; an in-memory repository is allowed only for tests.
- Server-sent events (SSE) for one-way telemetry. WebSocket is unnecessary unless later requirements add bidirectional multiplayer.
- Zod schemas shared at the API boundary.

The implementer may adapt the framework to the teammate's existing backend, but the endpoints, invariants and tests in this document stay unchanged.

## 5. Runtime modes

| Mode | Backend | Telemetry | Persistence | Required |
| --- | --- | --- | --- | --- |
| `local` | absent | deterministic fixture | browser only | yes |
| `connected` | healthy | deterministic fixture or SSE | backend command log | yes for deployed demo if enabled |
| `degraded` | unreachable after start | local adapter continues | queued locally | yes |
| `replay` | optional | command timestamps | read-only reconstruction | yes |

The UI must show `Local simulation`, `Connected simulation` or `Offline, recording locally`. Never label fixture data as production or real infrastructure telemetry.

## 6. API contract

Base path: `/api/v1`. JSON only except the SSE endpoint.

### Shared response shape

```ts
type ApiSuccess<T> = {
  ok: true;
  requestId: string;
  data: T;
};

type ApiFailure = {
  ok: false;
  requestId: string;
  error: {
    code:
      | "INVALID_INPUT"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CONFLICT"
      | "RATE_LIMITED"
      | "REPLAY_MISMATCH"
      | "INTERNAL";
    message: string;
    recovery?: string;
  };
};
```

Do not return stack traces, database errors, prompts, secrets or provider responses.

### `GET /api/v1/health`

Public readiness check.

```json
{
  "ok": true,
  "requestId": "req_...",
  "data": {
    "status": "ready",
    "version": "git-sha",
    "database": "ready",
    "scenarioSchemaVersion": 1
  }
}
```

Return `503` if a dependency required for persistence is unavailable. Optional OpenAI generation must not make gameplay health fail.

### `POST /api/v1/runs`

Creates an anonymous run.

Input:

```ts
{
  scenarioId: "CASE-001";
  scenarioVersion: 1;
  clientBuild: string;
}
```

Output:

```ts
{
  runId: string;
  writeToken: string; // returned once; store in sessionStorage, never logs
  expiresAt: string;
  initialStateHash: string;
}
```

Use at least 128 bits of randomness for both identifiers. Hash the write token at rest. Anonymous runs expire after seven days unless product requirements explicitly change.

### `POST /api/v1/runs/:runId/commands`

Appends one command after it has been applied locally.

Authorization: `Bearer <writeToken>`.

```ts
{
  seq: number;
  kind: CommandKind;
  origin: "human" | "agent";
  input: unknown;
  incidentAtSec: number;
  stateVersionBefore: number;
  stateVersionAfter: number;
  result: ToolResult;
  idempotencyKey?: string;
  clientStateHash: string;
}
```

Server behavior:

1. Validate shape, size and allowlisted command kind.
2. Reject a skipped sequence with `409 CONFLICT` and return `expectedSeq`.
3. Treat `(runId, seq)` as unique.
4. Treat `(runId, hash(idempotencyKey))` as unique when a key exists.
5. Replay the stored command history with the shared engine.
6. Compare resulting version, result and replay signature with the client submission.
7. Persist only if they match. Otherwise return `409 REPLAY_MISMATCH` and do not advance the run.

The server verifies the deterministic result; it does not invent a different result.

### `POST /api/v1/runs/:runId/commands/batch`

Uploads queued commands after a temporary outage. Maximum 50 commands or 256 KB per request. Apply the same verification transactionally: either the complete contiguous batch persists or none of it does.

### `GET /api/v1/runs/:runId`

Authorization: the run write token. Returns:

- scenario id/version;
- run status and current sequence;
- replay signature;
- ending and compact score when closed;
- connection-safe metadata, never the token or raw provider output.

### `GET /api/v1/runs/:runId/commands?after=<seq>`

Returns the ordered command log needed for resume/replay. Default limit 100, maximum 500. The client reconstructs state using `replay()` and verifies the returned state hash.

### `GET /api/v1/runs/:runId/events`

SSE endpoint. Authorization may use a short-lived stream token obtained with the write token; do not put the persistent write token in a query string.

Event envelope:

```ts
type TelemetryEvent = {
  eventId: string;
  sequence: number;
  scenarioTimeSec: number;
  source: "identity" | "endpoint" | "network" | "data" | "system";
  severity: "info" | "low" | "medium" | "high" | "critical";
  entityIds: string[];
  kind: string;
  payload: Record<string, string | number | boolean | null>;
  emittedAt: string;
};
```

SSE rules:

- emit `id: <eventId>` and support `Last-Event-ID`;
- send heartbeat comments every 15 seconds;
- preserve monotonically increasing `sequence`;
- deduplicate by `eventId` in both server and client;
- expose `connected`, `reconnecting`, `stale` and `offline` states;
- mark stale after 10 seconds without an event or heartbeat;
- use capped exponential reconnect delay from 500 ms to 10 seconds;
- never let reconnect reset or mutate game state.

### `POST /api/v1/scenarios/generate` (optional, feature-flagged, NOT-SHIPPED for this release)

This endpoint is disabled unless server-side OpenAI credentials and an explicit feature flag exist. It is **NOT-SHIPPED for this release**: the flag is off, the route is not mounted in the release build, and Case 001 is a fixed deterministic template that generation cannot alter. It is specified now so a future case pack has a boundary to build against, not so it can be enabled late.

Input contains bounded educational parameters only:

```ts
{
  topic: "phishing_session_theft" | "ransomware_triage" | "cloud_misconfiguration";
  difficulty: "beginner" | "intermediate";
  locale: "en" | "tr";
  durationMinutes: 5 | 7 | 10;
}
```

The server requests a typed `ScenarioPlan`, validates it, stores it as `draft`, and returns its id and validation report. Generation never starts a run automatically.

## 7. ScenarioPlan boundary — data-driven case packs

Status: **feature-flagged and NOT-SHIPPED for this release.** The flag is off,
the generation route is not mounted in the release build, and Case 001 is a
fixed deterministic template. Nothing in this section may regress Case 001; if
enabling the flag can change Case 001 in any way, the implementation is wrong.

This section exists so that future case packs are *data*, validated at the
boundary, rather than code or model output that reaches the engine. It is the
same split as everywhere else: the model may write **content**, never
**behaviour**.

### Invariants

1. **Strict schema validation.** A plan is parsed against the schema below with
   `additionalProperties: false` and explicit length limits on every string. A
   plan that does not validate is rejected whole; there is no partial import and
   no coercion.
2. **Unknown action or tool names are rejected.** Every action id, artifact id,
   diagnostic id, decision id, option id, finding id and tool name in a plan must
   already exist in the deterministic case template it targets. A plan cannot
   introduce a new id, and it cannot rename an existing one.
3. **The decision graph must be completable.** Every decision must be reachable
   from the initial state through some legal sequence, every prerequisite must
   name a step that exists, and no cycle may make a decision unreachable. A plan
   whose graph cannot be traversed to an ending is rejected.
4. **At least one correct solution path must exist.** Validation runs the plan
   through the engine and proves a path to the contained ending with no
   unresolved critical finding. A case that cannot be solved is not a case.
5. **All identities, IPs, domains and logs are synthetic.** Addresses must fall
   in documentation/test ranges, domains must be on the fictional allowlist, and
   no plan may contain a real organisation, person, credential or host. This is
   validated, not requested.
6. **Score and outcomes are computed by the engine.** A plan carries no score,
   no score delta, no ending, no bucket weight and no state transition. Those
   fields do not exist in the schema, so a plan cannot express them.
7. **The model never writes runtime state directly.** Generation produces a
   stored `draft`; import is a separate, explicit, human-reviewed step; and the
   imported plan supplies content to a template that the engine already owns.
   There is no path from a model response to a mutation of a live run.
8. **A broken or unsolvable generated case is rejected**, logged with its
   validation report, and left as `draft`. It is never published, never
   partially imported and never repaired automatically.

### Schema

The scenario plan may supply narrative content and map approved ids; it may not define executable behavior.

```ts
type ScenarioPlan = {
  schemaVersion: 1;
  scenarioId: string;
  title: string;
  learningObjectives: string[];
  opening: {
    timestamp: string;
    alertSummary: string;
    colleagueLine: string;
    guidanceIntro: string;
  };
  facts: Array<{ id: string; text: string }>;
  artifacts: Array<{
    id: ArtifactId;
    title: string;
    fields: Array<{ label: string; value: string; decisive: boolean }>;
    untrusted: boolean;
  }>;
  explanationVariants: Partial<Record<HintTopic, string[]>>;
  debriefVariants: { contained: string[]; partial: string[] };
};
```

Every narrative string in a plan is a **fallback and tone reference**, not the
shipped script: when an agent is connected, narration is generated live through
`present_guidance`. `opening.colleagueLine`, `opening.guidanceIntro`,
`explanationVariants` and `debriefVariants` are what the page says when no agent
is present, and what a generated line should sound like when one is.

`guidanceIntro` was `companionIntro` — the opening line the removed robot spoke.
The slot outlived the character because the *channel* did: it is the
deterministic opening for the guidance channel, and a plan must not write it in
a persona's first person. `colleagueLine` is VERA's, and she reports operational
facts; guidance is never authored under her name. `schemaVersion` deliberately
stays at `1`: no plan has been authored against this schema outside its own
test, and `tests/backend/unit/scenarioPlan.test.ts` pins that a plan claiming
version `2` is refused.

Validation gates:

- schema and string length limits, `additionalProperties: false`;
- unknown action, tool, artifact, diagnostic, decision or option names rejected;
- ids must already exist in the selected deterministic case template;
- decision graph traversable and completable;
- at least one proven correct solution path to the contained ending;
- all identities, IPs, domains and log lines synthetic and allowlisted;
- no URLs except fictional allowlisted domains;
- no commands, code blocks, SQL, credentials, exploit payloads or HTML;
- all attacker-authored text marked `untrusted`;
- locale and learning objectives present;
- no direct scores, endings or state transitions — the schema has no field for
  them, and the engine computes all three;
- a plan that fails any gate stays `draft` with its validation report attached;
- human review required before `draft` becomes `published`;
- the whole path stays behind the feature flag and off in the release build.

## 8. Persistence model

Minimum relational tables:

### `runs`

`id`, `write_token_hash`, `scenario_id`, `scenario_version`, `status`, `last_seq`, `state_version`, `state_hash`, `ending`, `score_json`, `client_build`, `created_at`, `updated_at`, `expires_at`.

### `run_commands`

`run_id`, `seq`, `kind`, `origin`, `input_json`, `result_json`, `incident_at_sec`, `state_version_before`, `state_version_after`, `idempotency_key_hash`, `created_at`.

Primary key: `(run_id, seq)`. Unique partial index on `(run_id, idempotency_key_hash)` when non-null.

### `scenario_versions`

`scenario_id`, `version`, `schema_version`, `status`, `plan_json`, `validation_json`, `prompt_version`, `model_id`, `created_at`, `published_at`.

Primary key: `(scenario_id, version)`. Published versions are immutable.

### `narrative_log`

`run_id`, `narrative_sequence`, `speaker`, `tone`, `language`, `message`,
`related_artifact_id`, `related_decision_id`, `based_on_state_version`,
`idempotency_key_hash`, `origin`, `delivery`, `scenario_time_sec`, `created_at`.

Primary key: `(run_id, narrative_sequence)`. Unique index on
`(run_id, idempotency_key_hash)`. Append-only: no update, no delete. It stores
finished lines only — there is no column for model reasoning, and none may be
added. It is an audit and replay record; it is never read back into gameplay.

### `telemetry_events`

`run_id`, `event_id`, `sequence`, `scenario_time_sec`, `source`, `severity`, `entity_ids_json`, `kind`, `payload_json`, `emitted_at`.

Unique keys: `(run_id, event_id)` and `(run_id, sequence)`.

## 9. Offline queue and resume

- Keep unacknowledged commands in IndexedDB, not localStorage.
- Never store the write token in logs, analytics or a persisted command payload.
- On reconnect, read server `last_seq`, upload only the contiguous missing suffix, then compare replay signatures.
- If signatures disagree, freeze persistence sync, keep local gameplay available, show `Run sync needs review`, and offer a JSON export. Do not overwrite either history automatically.
- A browser refresh starts from the server log only when a valid token exists; otherwise preserve the current documented fresh-start behavior.

## 10. Security and privacy

- Same-origin API in production where possible.
- Strict CORS allowlist; never `*` with credentials.
- Validate `Origin` on every mutation.
- Rate-limit run creation, generation and command append separately.
- Cap JSON body size at 256 KB; scenario generation input at 16 KB.
- Use TLS only outside localhost.
- Keep `OPENAI_API_KEY`, database URL and signing secrets server-side.
- Redact bearer tokens, prompts, artifact content and personal fields from logs.
- Store fictional/synthetic case identities only. Do not accept uploaded customer logs in the hackathon build.
- Treat scenario text and artifact text as untrusted data. Never interpolate it into HTML, shell, SQL or model instructions.
- Give every response an opaque request id and every persisted mutation an audit timestamp.
- Run dependency and secret scans in CI.

## 11. Observability

Structured server logs:

- request id, route, method, status and duration;
- run id hash, never token;
- accepted/rejected command kind and sequence;
- replay duration and mismatch reason code;
- SSE connections/reconnects and last delivered sequence;
- scenario generation latency, model id and token usage, but not raw prompts/results.

Metrics:

- API p50/p95 latency;
- command append success/conflict/mismatch counts;
- SSE active connections and reconnect rate;
- replay verification duration;
- generation success/validation rejection rate;
- database and health status.

No observability failure may break local gameplay.

## 12. Performance targets

- Health p95 <100 ms.
- Run creation p95 <300 ms excluding cold start.
- Single command verification p95 <250 ms.
- Batch of 50 commands p95 <1 s.
- SSE event visible in the UI <250 ms after browser receipt.
- Resume and replay of 100 commands <500 ms on the server and <250 ms in the browser target machine.

Measure these locally and on the deployed service. Do not infer them from framework choice.

## 13. Test contract

### Unit

- API schema acceptance/rejection.
- token hashing and constant-time comparison.
- event deduplication and sequence checks.
- ScenarioPlan allowlist and content limits.
- ScenarioPlan rejection of unknown action/tool names, an incompletable decision graph, a case with no correct solution path, and any non-synthetic identity, address, domain or log line.
- The generation feature flag is off by default and the route is not mounted in the release build.
- replay verifier detects altered input, result, sequence and state hash.

### Integration

- create run, append command, fetch and replay to identical signature;
- duplicate `(runId, seq)` returns the original acknowledgement;
- duplicate idempotency key cannot apply twice;
- skipped sequence returns expected sequence;
- batch is transactional;
- expired/invalid token rejected;
- provider outage leaves scenario generation unavailable but health/gameplay usable;
- database failure returns controlled errors without leaking internals.

### Browser E2E

- connected run has the same ending/score as local mode;
- server loss mid-case falls back without losing a command;
- reconnect uploads the exact missing suffix once;
- SSE duplicate/reordered events do not duplicate UI rows;
- refresh/resume reconstructs the same replay signature;
- WebMCP and human-origin commands persist with correct origins.

## 14. Backend definition of done

- Local mode remains fully playable with zero backend requests.
- Connected mode passes deterministic replay after every command.
- No source of truth other than the shared deterministic engine decides gameplay.
- Secrets never enter the client bundle or logs.
- OpenAI generation is optional, schema-bound, server-side and human-reviewed, and is NOT-SHIPPED for this release.
- Enabling or disabling the generation feature flag cannot change Case 001 in any way.
- API, database migration, environment example and deployment instructions exist.
- Unit, integration, offline/reconnect and load tests pass.
- Production health, logs and metrics can diagnose a failed judge run.

## References

- [CYCASE WebMCP contract](./WEBMCP_CONTRACT.md)
- [OpenAI remote MCP documentation](https://developers.openai.com/api/docs/mcp)
- [OpenAI site tools documentation](https://learn.chatgpt.com/docs/webmcp)

