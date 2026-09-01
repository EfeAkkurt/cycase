import { expect, test, type Page } from '@playwright/test';

import {
  callTool,
  installModelContext,
  openDashboard,
  readStateVersion,
  runSequence,
} from './helpers';

/**
 * The task and evidence flow, in the browser.
 *
 * This is the acceptance list for the flow work, stated as things a person
 * does rather than as functions that return the right shape:
 *
 *   - the case cannot reach D2 before the player has seen the evidence;
 *   - one control cannot make five invisible state changes;
 *   - a wrong choice has a recovery, and it is deterministic;
 *   - narration cannot move the state or the score on its own;
 *   - keyboard focus lands on the record the player was sent to read;
 *   - every command leaves a receipt beside the control that ran it, quickly.
 */

const CARD = '#next-step';

function option(page: Page, id: string) {
  return page.locator(`#decision-option-${id}`);
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}`) });
}

/* ------------------------------------------------------------------ */

test.describe('evidence is read where it can be seen', () => {
  test('the CTA opens the record on Evidence instead of reading it in place', async ({ page }) => {
    await openDashboard(page);
    await option(page, 'D1_preserve_and_inspect').click();

    // Still on Command, and the message has not been read.
    await expect(page.locator(CARD)).toContainText('Read the reported message');
    await expect(page.locator('#evidence-art_email_001')).toHaveCount(0);

    await page.locator('#next-step-cta').click();

    // The console went to Evidence, selected the right record, and shows it.
    await expect(page.locator('#evidence-inspector')).toBeVisible();
    await expect(page.locator('#evidence-record-title')).toContainText('Phishing message');
    await expect(page.locator('#evidence-art_email_001')).toHaveAttribute('aria-current', 'true');
  });

  test('D2 is unreachable until the record has actually been displayed', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await option(page, 'D1_preserve_and_inspect').click();

    /*
     * Read the case the way the agent does, from the state the console is in
     * before the record has been opened. The decision must be blocked, and it
     * must say what it is blocked on — an agent that only saw "no open
     * decision" could not tell a gated case from a finished one.
     */
    const version = await readStateVersion(page);
    const before = await callTool<{
      openDecision: unknown;
      blockedDecision: { decisionId: string; missing: { artifacts: string[] } } | null;
    }>(page, 'get_incident', { stateVersion: version });

    expect(before.data?.openDecision).toBeNull();
    expect(before.data?.blockedDecision?.decisionId).toBe('D2');
    expect(before.data?.blockedDecision?.missing.artifacts).toContain('art_email_001');
    await expect(option(page, 'D2_compare_signin_telemetry')).toHaveCount(0);

    // Open it, which is the only path the console offers.
    await page.locator('#next-step-cta').click();
    await expect(page.locator('#evidence-record-title')).toBeVisible();

    // Only now does D2 exist.
    await nav(page, 'Command').click();
    await expect(option(page, 'D2_compare_signin_telemetry')).toBeVisible();
  });

  test('keyboard focus lands on the record, not on the list it came from', async ({ page }) => {
    await openDashboard(page);
    await option(page, 'D1_preserve_and_inspect').click();
    await page.locator('#next-step-cta').click();

    await expect(page.locator('#evidence-record-title')).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('evidence-record-title');
  });

  test('the timeline and the rail open a record the same way the guide does', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
    ]);

    // The rail's optional-evidence shortcut.
    await nav(page, 'Command').click();
    await page.locator('#explore-more summary').click();
    const shortcut = page.locator('#rail-explore').getByRole('button', { name: /^Open / }).first();
    const name = (await shortcut.getAttribute('aria-label')) ?? '';
    await shortcut.click();
    await expect(page.locator('#evidence-inspector')).toBeVisible();
    expect(name).toContain('Open');

    // The timeline's, on a record that has already been read.
    await nav(page, 'Timeline').click();
    const timelineOpen = page.locator('[id^="timeline-open-"]').first();
    if (await timelineOpen.count()) {
      await timelineOpen.click();
      await expect(page.locator('#evidence-inspector')).toBeVisible();
      await expect(page.locator('#evidence-record-title')).toBeVisible();
    }
  });
});

test.describe('one control, one action', () => {
  test('the containment step is five separately authorised presses', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      {
        tool: 'submit_decision',
        input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
      },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
    ]);
    await nav(page, 'Command').click();
    await expect(page.locator('#next-step-title')).toContainText('Contain the identity');

    /*
     * The acceptance criterion, measured: no single press may move the case by
     * more than one version. The old card ran five commands here — a session
     * inventory, two credential operations, an evidence read and an endpoint
     * isolation — from one click and one dialog.
     */
    const deltas: number[] = [];
    for (let press = 0; press < 5; press += 1) {
      const before = await readStateVersion(page);
      await page.locator('#next-step-cta').click();
      const dialog = page.getByRole('alertdialog');
      if (await dialog.count()) {
        await dialog.getByRole('button', { name: 'Confirm' }).click();
      }
      await nav(page, 'Command').click();
      deltas.push((await readStateVersion(page)) - before);
    }

    expect(deltas).toEqual([1, 1, 1, 1, 1]);
  });

  test('asks for confirmation over the revocation and not over the read before it', async ({
    page,
  }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      {
        tool: 'submit_decision',
        input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
      },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
    ]);
    await nav(page, 'Command').click();

    // Stage one is the session inventory: an ordinary read, no dialog, and no
    // destructive chip inherited from the operation queued behind it.
    await expect(page.locator(CARD).getByText('Consequential')).toHaveCount(0);
    await page.locator('#next-step-cta').click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // Stage two is the revocation, and it asks.
    await expect(page.locator(CARD)).toContainText('Revoke active sessions');
    await expect(page.locator(CARD).getByText('Consequential')).toBeVisible();
    await page.locator('#next-step-cta').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  });

  test('plain navigation never asks for a confirmation', async ({ page }) => {
    await openDashboard(page);
    for (const route of ['Investigate', 'Evidence', 'Respond', 'Timeline', 'Command']) {
      await nav(page, route).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    }
  });
});

test.describe('receipts', () => {
  test('appear beside the control that issued the command, well inside 250ms', async ({ page }) => {
    await openDashboard(page);

    /*
     * Measured inside the page, from the press to the receipt existing in the
     * DOM. Timing it from the test process would be timing Playwright's own
     * actionability checks and IPC as well, which is not what the contract is
     * about — the claim is that the console answers the player quickly, not
     * that a driver round trip is fast.
     */
    await page.evaluate(() => {
      const target = window as unknown as { __pressedAt?: number; __receiptAt?: number };
      document.addEventListener(
        'click',
        () => {
          target.__pressedAt = performance.now();
        },
        { capture: true, once: true },
      );
      const observer = new MutationObserver(() => {
        if (target.__receiptAt !== undefined) return;
        if (document.querySelector('[data-testid="receipt"]')) {
          target.__receiptAt = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true });
    });

    await option(page, 'D1_preserve_and_inspect').click();
    await page.locator('[data-testid="receipt"]').first().waitFor({ state: 'visible' });

    const elapsed = await page.evaluate(() => {
      const target = window as unknown as { __pressedAt?: number; __receiptAt?: number };
      return (target.__receiptAt ?? Infinity) - (target.__pressedAt ?? 0);
    });

    console.log(`receipt in the DOM ${Math.round(elapsed)}ms after the press`);
    expect(elapsed).toBeLessThanOrEqual(250);

    // Inside the card that ran it, and answering the three questions.
    const receipt = page.locator(`${CARD} [data-testid="receipt"]`);
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('Result');
    await expect(receipt).toContainText('What changed');
    await expect(receipt).toContainText('Why it matters');
  });

  test('a refused action says what did not change and offers one recovery', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await nav(page, 'Respond').click();

    /*
     * The console will not *let* a person press `close_case` before D6 — the
     * control is disabled and says why, which is the better failure. So the
     * refusal here comes from the agent, which is the path that can genuinely
     * produce one, and the point of the test is where the answer lands: at the
     * control the call was aimed at, not in a corner of the page.
     */
    const version = await readStateVersion(page);
    await expect(page.locator('#action-close_case').getByRole('button').first()).toBeDisabled();

    const refused = await callTool(page, 'take_response_action', {
      actionId: 'close_case',
      stateVersion: version,
      idempotencyKey: 'flow-refused-close',
    });
    expect(refused.ok).toBe(false);

    const receipt = page.locator('#receipt-action-close_case');
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute('data-receipt-state', 'failed');
    await expect(receipt).toContainText('What did not change');
    await expect(page.locator('#receipt-unchanged')).toContainText(`still v${version}`);

    // Exactly one recovery control, and the case really did not move.
    await expect(receipt.locator('#receipt-recovery')).toHaveCount(1);
    expect(await readStateVersion(page)).toBe(version);
  });

  test('a diagnostic reports next to the diagnostic, not at the foot of the page', async ({
    page,
  }) => {
    await openDashboard(page);
    await nav(page, 'Respond').click();
    await page.locator('#diagnostic-session_inventory').getByRole('button', { name: 'Run' }).click();

    const receipt = page.locator('#receipt-diagnostic-session_inventory');
    await expect(receipt).toBeVisible();
    // Inside the diagnostic's own block: proximity, asserted structurally.
    await expect(page.locator('#diagnostic-session_inventory [data-testid="receipt"]')).toHaveCount(
      1,
    );
  });
});

test.describe('a wrong choice has a way back', () => {
  test('offers the operation the decision withheld, and it closes the finding', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);

    // D3_password_only recommends the reset and not the revocation, so the
    // guided path steps past `revoke_sessions` and the stolen session stays up.
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      {
        tool: 'submit_decision',
        input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
      },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_password_only' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
      { tool: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
      { tool: 'take_response_action', input: { actionId: 'reset_credentials' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
      { tool: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
    ]);
    await nav(page, 'Command').click();

    // The console says the incident is still broken, and how to fix it.
    await expect(page.locator('#corrective-path')).toBeVisible();
    await expect(page.locator('#corrective-why')).toContainText('still open');
    const cta = page.locator('#corrective-cta');
    await expect(cta).toContainText('Revoke active sessions');

    await cta.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();

    // Deterministic: the finding closes and the offer withdraws itself.
    await expect(page.locator('#corrective-path')).toHaveCount(0);
    await nav(page, 'Command').click();
    await expect(page.locator('#finding-rogue_session_active')).toContainText('Resolved');
  });
});

test.describe('narration cannot move the case', () => {
  test('a proposal changes nothing until the player approves it', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);

    const version = await readStateVersion(page);
    const spoken = await callTool(page, 'present_guidance', {
      basedOnStateVersion: version,
      idempotencyKey: 'flow-proposal-1',
      tone: 'teaching',
      language: 'en',
      message: 'The reported message is still evidence. Preserving it costs nothing.',
      proposes: {
        kind: 'submit_decision',
        decisionId: 'D1',
        optionId: 'D1_preserve_and_inspect',
      },
    });

    expect(spoken.ok).toBe(true);
    // The receipt says so, and the console agrees.
    expect((spoken.data as { affectsState: boolean }).affectsState).toBe(false);
    expect((spoken.data as { affectsScore: boolean }).affectsScore).toBe(false);
    expect(await readStateVersion(page)).toBe(version);

    // It is on screen as a question, under the case's own label for the move.
    const proposal = page.locator('#agent-proposal');
    await expect(proposal).toBeVisible();
    await expect(page.locator('#agent-proposal-move')).toContainText(
      'Preserve the reported message',
    );
    // The model's words are present, and marked as the model's.
    await expect(page.locator('#agent-proposal-message')).toContainText('still evidence');

    // Declining leaves the case exactly where it was.
    await page.locator('#agent-proposal-decline').click();
    await expect(proposal).toHaveCount(0);
    expect(await readStateVersion(page)).toBe(version);
    await expect(option(page, 'D1_preserve_and_inspect')).toBeVisible();
  });

  test('approving a proposal runs it as the player', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);

    const version = await readStateVersion(page);
    await callTool(page, 'present_guidance', {
      basedOnStateVersion: version,
      idempotencyKey: 'flow-proposal-2',
      tone: 'teaching',
      language: 'en',
      message: 'Preserving the message keeps the evidence available.',
      proposes: {
        kind: 'submit_decision',
        decisionId: 'D1',
        optionId: 'D1_preserve_and_inspect',
      },
    });

    await page.locator('#agent-proposal-approve').click();

    expect(await readStateVersion(page)).toBe(version + 1);
    // Recorded as the player's move, not the agent's: the activity feed
    // attributes every call, and this one is human.
    await expect(page.locator('#rail-activity')).toContainText('submit_decision');
    const agentCalls = await page
      .locator('#rail-activity .feed__row', { hasText: 'submit_decision' })
      .first()
      .innerText();
    expect(agentCalls).toContain('You');
  });

  test('an ordinary narrated line moves neither the state nor the score', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);

    const version = await readStateVersion(page);
    for (let index = 0; index < 3; index += 1) {
      const result = await callTool(page, 'present_guidance', {
        basedOnStateVersion: version,
        idempotencyKey: `flow-narration-${index}`,
        tone: 'teaching',
        language: 'en',
        message: `Line ${index}: read the reported message before deciding.`,
      });
      expect(result.ok).toBe(true);
    }

    expect(await readStateVersion(page)).toBe(version);
    // And no receipt: narration is not a command with a consequence.
    await expect(page.locator(`${CARD} [data-testid="receipt"]`)).toHaveCount(0);
  });
});

test.describe('the console remembers where you were', () => {
  test('keeps the raw/explained reading across a round trip', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);

    await nav(page, 'Evidence').click();
    await page.locator('#evidence-art_email_001').click();
    await page.getByRole('tab', { name: 'Explained' }).click();
    await expect(page.getByRole('tab', { name: 'Explained' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await nav(page, 'Respond').click();
    await nav(page, 'Evidence').click();

    // Still explained, and still the same record.
    await expect(page.getByRole('tab', { name: 'Explained' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#evidence-record-title')).toContainText('Phishing message');
  });

  test('keeps the SIEM query across a round trip', async ({ page }) => {
    await openDashboard(page);
    await nav(page, 'Investigate').click();

    const bar = page.locator('#siem-query');
    await bar.fill('severity:critical');
    await expect(bar).toHaveValue('severity:critical');

    // Pivot to read what the query turned up, then come back to it.
    await nav(page, 'Evidence').click();
    await nav(page, 'Investigate').click();

    // Retyping a query from memory is how an investigation loses its thread.
    await expect(page.locator('#siem-query')).toHaveValue('severity:critical');
  });

  test('keeps the chronology filter across a round trip', async ({ page }) => {
    await openDashboard(page);
    await nav(page, 'Timeline').click();
    await page.locator('#timeline-origin-human').click();
    await expect(page.locator('#timeline-origin-human')).toHaveAttribute('aria-pressed', 'true');

    await nav(page, 'Command').click();
    await nav(page, 'Timeline').click();
    await expect(page.locator('#timeline-origin-human')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('one progress model', () => {
  test('names the incident phase and never a step-of-eleven count', async ({ page }) => {
    await openDashboard(page);

    const rail = page.locator('#phase-rail');
    await expect(rail).toBeVisible();
    for (const phase of ['Triage', 'Investigate', 'Contain', 'Scope', 'Close']) {
      await expect(rail).toContainText(phase);
    }
    await expect(page.locator('#phase-triage')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#phase-progress')).toContainText('Triage');

    // Neither rival counter survives anywhere on the page.
    await expect(page.locator('body')).not.toContainText(/Step \d+ of \d+/);
    await expect(page.locator('body')).not.toContainText(/Decision \d+ of \d+/);
  });

  test('advances the active phase as the case progresses', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      {
        tool: 'submit_decision',
        input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
      },
    ]);
    await nav(page, 'Command').click();

    await expect(page.locator('#phase-investigate')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#phase-triage')).toHaveAttribute('data-phase-state', 'done');
  });
});
