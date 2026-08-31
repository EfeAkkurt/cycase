import * as z from 'zod';

import { ARTIFACT_IDS, HINT_TOPICS } from '../src/game/types';

/**
 * The scenario-plan boundary (contract §7).
 *
 * A generated plan may supply *narrative content* and *map ids that already
 * exist*. It may never define behaviour. That distinction is the whole security
 * story for optional LLM generation, so it is enforced here by a schema plus a
 * set of content gates rather than by prompt wording — a model that ignores its
 * instructions still cannot get past this file.
 *
 * The generation route itself is not shipped (no server-side OpenAI credential
 * exists in this environment, and §6 marks it optional and flag-gated). The
 * schema and gates ship anyway: they are cheap, they are what makes a future
 * generator safe, and they are testable today against hand-written plans.
 */

export const SCENARIO_PLAN_SCHEMA_VERSION = 1;

export const PLAN_LIMITS = {
  titleMax: 120,
  scenarioIdMax: 64,
  learningObjectiveMax: 200,
  learningObjectivesMax: 6,
  learningObjectivesMin: 1,
  factMax: 300,
  factsMax: 12,
  fieldLabelMax: 60,
  fieldValueMax: 300,
  fieldsMax: 12,
  artifactsMax: 12,
  variantMax: 600,
  variantsPerTopicMax: 4,
  debriefVariantsMax: 4,
  openingLineMax: 400,
  /** Total serialized plan size. Keeps one plan out of the 256 KB body cap. */
  totalBytesMax: 64 * 1024,
} as const;

/** Fictional domains a plan is allowed to name. Anything else is rejected. */
export const ALLOWED_PLAN_DOMAINS = [
  'cy-case.example',
  'cy-case-portal.example',
  'files.cy-case.example',
  'example.com',
  'example.org',
  'invalid',
] as const;

const artifactIdSchema = z.enum(ARTIFACT_IDS as unknown as [string, ...string[]]);
const hintTopicSchema = z.enum(HINT_TOPICS as unknown as [string, ...string[]]);

export const scenarioPlanSchema = z
  .object({
    schemaVersion: z.literal(SCENARIO_PLAN_SCHEMA_VERSION),
    scenarioId: z
      .string()
      .min(1)
      .max(PLAN_LIMITS.scenarioIdMax)
      .regex(/^[A-Z0-9-]+$/, 'scenarioId must be upper-case ids and dashes'),
    locale: z.enum(['en', 'tr']),
    title: z.string().min(1).max(PLAN_LIMITS.titleMax),
    learningObjectives: z
      .array(z.string().min(1).max(PLAN_LIMITS.learningObjectiveMax))
      .min(PLAN_LIMITS.learningObjectivesMin)
      .max(PLAN_LIMITS.learningObjectivesMax),
    /*
     * `guidanceIntro` was `companionIntro`: the opening line the robot spoke
     * before it was removed. The slot survives the character because the
     * *channel* does — it is the deterministic opening for the guidance channel,
     * what the page says before any agent connects. It is not a second speaker,
     * and the field is not named for one. The version is deliberately left at 1:
     * no plan has ever been authored against this schema outside its own test,
     * and `scenarioPlan.test.ts` pins that a plan claiming version 2 is refused.
     */
    opening: z
      .object({
        timestamp: z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'timestamp must be HH:MM:SS'),
        alertSummary: z.string().min(1).max(PLAN_LIMITS.openingLineMax),
        colleagueLine: z.string().min(1).max(PLAN_LIMITS.openingLineMax),
        guidanceIntro: z.string().min(1).max(PLAN_LIMITS.openingLineMax),
      })
      .strict(),
    facts: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
            text: z.string().min(1).max(PLAN_LIMITS.factMax),
          })
          .strict(),
      )
      .max(PLAN_LIMITS.factsMax),
    artifacts: z
      .array(
        z
          .object({
            id: artifactIdSchema,
            title: z.string().min(1).max(PLAN_LIMITS.titleMax),
            fields: z
              .array(
                z
                  .object({
                    label: z.string().min(1).max(PLAN_LIMITS.fieldLabelMax),
                    value: z.string().min(1).max(PLAN_LIMITS.fieldValueMax),
                    decisive: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(PLAN_LIMITS.fieldsMax),
            untrusted: z.boolean(),
          })
          .strict(),
      )
      .max(PLAN_LIMITS.artifactsMax),
    // `Partial<Record<HintTopic, string[]>>`: a plan may supply variants for
    // some topics and leave the deterministic copy in place for the rest.
    // `z.record` over an enum would demand every key.
    explanationVariants: z.partialRecord(
      hintTopicSchema,
      z.array(z.string().min(1).max(PLAN_LIMITS.variantMax)).max(PLAN_LIMITS.variantsPerTopicMax),
    ),
    debriefVariants: z
      .object({
        contained: z
          .array(z.string().min(1).max(PLAN_LIMITS.variantMax))
          .min(1)
          .max(PLAN_LIMITS.debriefVariantsMax),
        partial: z
          .array(z.string().min(1).max(PLAN_LIMITS.variantMax))
          .min(1)
          .max(PLAN_LIMITS.debriefVariantsMax),
      })
      .strict(),
  })
  .strict();

export type ScenarioPlan = z.infer<typeof scenarioPlanSchema>;

/* ------------------------------------------------------------------ *
 * Content gates
 * ------------------------------------------------------------------ */

export interface PlanViolation {
  /** Machine-readable gate id, so a validation report is diffable. */
  gate: string;
  path: string;
  message: string;
}

export interface PlanValidationReport {
  ok: boolean;
  schemaVersion: number;
  violations: PlanViolation[];
  /** Set only when every gate passed. */
  plan?: ScenarioPlan;
}

/**
 * Artifact ids a plan may reference. Passed in rather than imported from the
 * deterministic template so a second case can reuse this validator unchanged.
 */
export interface PlanValidationOptions {
  allowedArtifactIds: readonly string[];
  allowedDomains?: readonly string[];
}

/** Attacker-authored artifact kinds. Their text must always be marked untrusted. */
const ATTACKER_AUTHORED_ARTIFACT_IDS = new Set(['art_email_001', 'art_url_001']);

/**
 * Patterns that mean "this text is trying to be executable".
 *
 * Deliberately blunt: a plan is educational prose plus log-shaped field values.
 * None of these belong in it, and a false positive costs a regenerated
 * sentence, while a false negative costs an injection.
 */
const FORBIDDEN_CONTENT: { gate: string; pattern: RegExp; message: string }[] = [
  { gate: 'no_html', pattern: /<\s*\/?\s*[a-zA-Z][^>]*>/, message: 'HTML markup is not allowed' },
  { gate: 'no_html', pattern: /&(?:#\d+|[a-z]+);/i, message: 'HTML entities are not allowed' },
  { gate: 'no_code_block', pattern: /```|\$\(|\{\{/, message: 'code fences and templates are not allowed' },
  {
    gate: 'no_sql',
    pattern: /\b(?:select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+table|union\s+select|alter\s+table)\b/i,
    message: 'SQL is not allowed',
  },
  {
    gate: 'no_shell',
    pattern: /(?:^|[\s;|&])(?:curl|wget|bash|sh|powershell|cmd\.exe|nc|ncat|python|node|eval|rm\s+-rf|Invoke-Expression|IEX)\b/i,
    message: 'shell commands are not allowed',
  },
  {
    gate: 'no_exploit_payload',
    pattern: /(?:javascript:|data:text\/html|base64,|\\x[0-9a-f]{2}|%[0-9a-f]{2}%[0-9a-f]{2})/i,
    message: 'encoded or scriptable payloads are not allowed',
  },
  {
    gate: 'no_credentials',
    pattern: /\b(?:password|passwd|api[_-]?key|secret|bearer|private[_-]?key|client[_-]?secret)\b\s*[:=]/i,
    message: 'credential material is not allowed',
  },
  {
    gate: 'no_credentials',
    pattern: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/,
    message: 'credential material is not allowed',
  },
  {
    gate: 'no_state_transition',
    pattern: /\b(?:stateVersion|scoreDelta|idempotencyKey|caseClosed|take_response_action|submit_decision|run_diagnostic|inspect_artifact)\b/,
    message: 'a plan may not name engine commands or state fields',
  },
  {
    gate: 'no_direct_score',
    pattern: /\b(?:score|points?|ending)\s*[:=]\s*[-+]?\d/i,
    message: 'a plan may not assign score or endings',
  },
];

const URL_PATTERN = /\b(?:https?:\/\/|www\.)([A-Za-z0-9.-]+)/gi;

function walkStrings(
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, path ? `${path}.${key}` : key, visit);
    }
  }
}

/**
 * Runs the schema and then every §7 gate. Returns a full violation list rather
 * than the first failure, because the report is stored next to the draft and a
 * reviewer needs to see everything that is wrong at once.
 */
export function validateScenarioPlan(
  candidate: unknown,
  options: PlanValidationOptions,
): PlanValidationReport {
  const violations: PlanViolation[] = [];
  const allowedDomains = options.allowedDomains ?? ALLOWED_PLAN_DOMAINS;

  const serialized = (() => {
    try {
      return JSON.stringify(candidate) ?? '';
    } catch {
      return '';
    }
  })();
  if (serialized.length > PLAN_LIMITS.totalBytesMax) {
    violations.push({
      gate: 'size_limit',
      path: '',
      message: `plan exceeds ${PLAN_LIMITS.totalBytesMax} bytes`,
    });
    return { ok: false, schemaVersion: SCENARIO_PLAN_SCHEMA_VERSION, violations };
  }

  const parsed = scenarioPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 25)) {
      violations.push({
        gate: 'schema',
        path: issue.path.join('.'),
        message: issue.message,
      });
    }
    return { ok: false, schemaVersion: SCENARIO_PLAN_SCHEMA_VERSION, violations };
  }

  const plan = parsed.data;
  const allowed = new Set(options.allowedArtifactIds);

  // Gate: ids must already exist in the selected deterministic case template.
  for (const [index, artifact] of plan.artifacts.entries()) {
    if (!allowed.has(artifact.id)) {
      violations.push({
        gate: 'known_ids',
        path: `artifacts[${index}].id`,
        message: `${artifact.id} is not in the deterministic case template`,
      });
    }
    // Gate: all attacker-authored text marked untrusted.
    if (ATTACKER_AUTHORED_ARTIFACT_IDS.has(artifact.id) && !artifact.untrusted) {
      violations.push({
        gate: 'untrusted_marking',
        path: `artifacts[${index}].untrusted`,
        message: `${artifact.id} is attacker-authored and must be marked untrusted`,
      });
    }
  }

  // Gate: content allowlist, applied to every string in the plan.
  walkStrings(plan, '', (text, path) => {
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.pattern.test(text)) {
        violations.push({ gate: rule.gate, path, message: rule.message });
      }
    }

    URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_PATTERN.exec(text)) !== null) {
      const host = (match[1] ?? '').replace(/^www\./i, '').toLowerCase();
      const permitted = allowedDomains.some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      );
      if (!permitted) {
        violations.push({
          gate: 'domain_allowlist',
          path,
          message: `${host} is not an allowlisted fictional domain`,
        });
      }
    }
  });

  if (violations.length > 0) {
    return { ok: false, schemaVersion: SCENARIO_PLAN_SCHEMA_VERSION, violations };
  }

  return { ok: true, schemaVersion: SCENARIO_PLAN_SCHEMA_VERSION, violations, plan };
}

/** Plans start as drafts. `published` requires a recorded human reviewer (§7). */
export type ScenarioVersionStatus = 'draft' | 'published' | 'rejected';
