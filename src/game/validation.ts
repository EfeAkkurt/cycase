import * as z from 'zod/mini';

import {
  ARTIFACT_IDS,
  DECISION_IDS,
  DIAGNOSTIC_IDS,
  GUIDANCE_LANGUAGES,
  GUIDANCE_MESSAGE_MAX,
  GUIDANCE_TONES,
  HINT_TOPICS,
  RESPONSE_ACTION_IDS,
} from './types';
import { DECISION_OPTION_BY_ID } from './fixtures/case001';

/**
 * Runtime validation for every command, whether it arrives from a dashboard
 * control or a WebMCP tool call.
 *
 * docs/WEBMCP_CONTRACT.md: "Validate every argument at runtime. JSON Schema is
 * not a security boundary." The JSON Schema published to the agent is a hint
 * for the model; these schemas are the actual gate.
 */

const stateVersion = z.int().check(z.gte(0));

/** Bounded so a hostile or confused caller cannot grow the ledger without limit. */
const idempotencyKey = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9._:-]+$/));

const optionIds = [...DECISION_OPTION_BY_ID.keys()] as [string, ...string[]];

export const getIncidentSchema = z.object({});

export const inspectArtifactSchema = z.object({
  artifactId: z.enum(ARTIFACT_IDS as unknown as [string, ...string[]]),
  stateVersion,
});

export const runDiagnosticSchema = z.object({
  diagnosticId: z.enum(DIAGNOSTIC_IDS as unknown as [string, ...string[]]),
  stateVersion,
});

export const takeResponseActionSchema = z.object({
  actionId: z.enum(RESPONSE_ACTION_IDS as unknown as [string, ...string[]]),
  stateVersion,
  idempotencyKey,
});

export const submitDecisionSchema = z.object({
  decisionId: z.enum(DECISION_IDS as unknown as [string, ...string[]]),
  optionId: z.enum(optionIds),
  stateVersion,
  idempotencyKey,
});

export const requestHintSchema = z.object({
  topic: z.enum(HINT_TOPICS as unknown as [string, ...string[]]),
  stateVersion,
});

/**
 * `present_guidance` — structure only.
 *
 * The enums, the version and the key pattern are decided here because a wrong
 * shape has no sensible recovery beyond "send the right shape". Everything
 * about the *message itself* — emptiness, length, markup, links — is checked in
 * `sanitiseGuidanceMessage` instead, so each refusal can carry recovery text
 * that names the actual fault. The engine's generic INVALID_INPUT path hands
 * back the staleness recovery string, which would be actively misleading for a
 * message that merely contained a URL.
 */
export const presentGuidanceSchema = z.object({
  basedOnStateVersion: stateVersion,
  idempotencyKey,
  tone: z.enum(GUIDANCE_TONES as unknown as [string, ...string[]]),
  language: z.enum(GUIDANCE_LANGUAGES as unknown as [string, ...string[]]),
  // A structural bound only. The engine re-checks the length after stripping
  // invisible characters, which is the number that actually matters.
  message: z.string().check(z.maxLength(GUIDANCE_MESSAGE_MAX * 4)),
  // The enum, not a free string: the published schema advertises the artifact
  // ids, and a gate looser than the advertised contract is the gap an attacker
  // aims at. It also keeps the "never invent evidence" rule true for narration
  // — a line cannot claim to be about an artifact that does not exist.
  relatedArtifactId: z.optional(z.enum(ARTIFACT_IDS as unknown as [string, ...string[]])),
  relatedDecisionId: z.optional(z.enum(DECISION_IDS as unknown as [string, ...string[]])),
});

export const COMMAND_SCHEMAS = {
  get_incident: getIncidentSchema,
  inspect_artifact: inspectArtifactSchema,
  run_diagnostic: runDiagnosticSchema,
  take_response_action: takeResponseActionSchema,
  submit_decision: submitDecisionSchema,
  request_hint: requestHintSchema,
  present_guidance: presentGuidanceSchema,
} as const;

export interface ValidationFailure {
  ok: false;
  message: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

/**
 * Validates unknown input and flattens zod issues into one short sentence.
 * Short on purpose: tool results are budgeted at ~1,500 characters.
 */
export function validate<T>(
  schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: unknown } },
  input: unknown,
): ValidationSuccess<T> | ValidationFailure {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as T };
  return { ok: false, message: describeIssues(parsed.error) };
}

function describeIssues(error: unknown): string {
  const issues = (error as { issues?: { path?: (string | number)[]; message?: string }[] })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return 'Input did not match the tool schema.';
  return issues
    .slice(0, 4)
    .map((issue) => {
      const path = (issue.path ?? []).join('.') || 'input';
      return `${path}: ${issue.message ?? 'invalid'}`;
    })
    .join('; ');
}

/**
 * JSON Schemas published to the agent through `document.modelContext`.
 * Kept hand-written and minimal so the descriptions read well in a tool picker.
 */
export const TOOL_JSON_SCHEMAS = {
  get_incident: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  inspect_artifact: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        enum: [...ARTIFACT_IDS],
        description: 'Artifact to inspect. Use get_incident to list availableArtifacts.',
      },
      stateVersion: {
        type: 'integer',
        minimum: 0,
        description: 'Current stateVersion, from the most recent tool result.',
      },
    },
    required: ['artifactId', 'stateVersion'],
    additionalProperties: false,
  },
  run_diagnostic: {
    type: 'object',
    properties: {
      diagnosticId: {
        type: 'string',
        enum: [...DIAGNOSTIC_IDS],
        description: 'Synthetic diagnostic to run against the current case state.',
      },
      stateVersion: { type: 'integer', minimum: 0 },
    },
    required: ['diagnosticId', 'stateVersion'],
    additionalProperties: false,
  },
  take_response_action: {
    type: 'object',
    properties: {
      actionId: {
        type: 'string',
        enum: [...RESPONSE_ACTION_IDS],
        description: 'Consequential response action to apply to the simulated environment.',
      },
      stateVersion: { type: 'integer', minimum: 0 },
      idempotencyKey: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._:-]+$',
        description: 'Unique per intended application. Re-sending the same key replays the original result instead of applying twice.',
      },
    },
    required: ['actionId', 'stateVersion', 'idempotencyKey'],
    additionalProperties: false,
  },
  submit_decision: {
    type: 'object',
    properties: {
      decisionId: {
        type: 'string',
        enum: [...DECISION_IDS],
        description: 'Decision point to answer. get_incident.openDecision names the one that is open.',
      },
      optionId: {
        type: 'string',
        enum: optionIds,
        description: 'One of the two options belonging to that decision.',
      },
      stateVersion: { type: 'integer', minimum: 0 },
      idempotencyKey: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._:-]+$',
      },
    },
    required: ['decisionId', 'optionId', 'stateVersion', 'idempotencyKey'],
    additionalProperties: false,
  },
  request_hint: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: [...HINT_TOPICS],
        description: 'Which aspect of the case to get teaching guidance on.',
      },
      stateVersion: { type: 'integer', minimum: 0 },
    },
    required: ['topic', 'stateVersion'],
    additionalProperties: false,
  },
  present_guidance: {
    type: 'object',
    properties: {
      basedOnStateVersion: {
        type: 'integer',
        minimum: 0,
        description:
          'The stateVersion this line was written about. Guidance about a state the player has already left is refused as STALE_STATE.',
      },
      idempotencyKey: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._:-]+$',
        description:
          'Unique per line. Re-sending the same key returns the original receipt and does not say the line twice.',
      },
      tone: {
        type: 'string',
        enum: [...GUIDANCE_TONES],
        description: 'How it should be delivered. Does not change any case fact.',
      },
      language: { type: 'string', enum: [...GUIDANCE_LANGUAGES] },
      message: {
        type: 'string',
        minLength: 1,
        maxLength: GUIDANCE_MESSAGE_MAX,
        description:
          'Plain text, at most 500 characters. No HTML, no markdown links, no http/https or javascript: URLs — those are refused, not stripped. Refer to evidence by artifact id.',
      },
      relatedArtifactId: {
        type: 'string',
        enum: [...ARTIFACT_IDS],
        description: 'Optional: the artifact the line is about.',
      },
      relatedDecisionId: {
        type: 'string',
        enum: [...DECISION_IDS],
        description: 'Optional: the decision the line is about.',
      },
    },
    required: ['basedOnStateVersion', 'idempotencyKey', 'tone', 'language', 'message'],
    additionalProperties: false,
  },
} as const;
