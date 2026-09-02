import { describe, expect, it } from 'vitest';

import { AGENT_PROMPTS, agentPrompt } from '../../src/webmcp/agentPrompts';
import { TOOL_DEFINITIONS } from '../../src/webmcp/tools';

/**
 * The starting prompt is the one piece of agent-facing text that is not a tool
 * description, so its rules are pinned here: short, starts the loop, and never
 * contradicts the descriptions it sits in front of.
 */
describe('the starting prompts', () => {
  const all = (['learn', 'solve'] as const).flatMap((mode) =>
    (['tr', 'en'] as const).map((language) => ({
      mode,
      language,
      text: agentPrompt(mode, language),
    })),
  );

  it('exist for both modes in both languages', () => {
    expect(all).toHaveLength(4);
    for (const { text } of all) expect(text.length).toBeGreaterThan(150);
  });

  it('stay short enough to paste without scrolling', () => {
    for (const { mode, language, text } of all) {
      expect(text.length, `${mode}/${language}`).toBeLessThanOrEqual(600);
    }
  });

  it('start the loop where the tools expect it to start', () => {
    for (const { text } of all) {
      expect(text).toContain('get_incident');
      expect(text).toContain('page');
    }
  });

  it('leave the consequential move with the player, as the tools do', () => {
    expect(AGENT_PROMPTS.learn.en).toContain('propose it and wait');
    expect(AGENT_PROMPTS.solve.en).toContain('wait for my approval');
    expect(AGENT_PROMPTS.learn.tr).toContain('öner ve bekle');
    expect(AGENT_PROMPTS.solve.tr).toContain('onayımı bekle');
  });

  it('hands the agent no persona, because present_guidance says it has none', () => {
    const guidance = TOOL_DEFINITIONS.find((tool) => tool.name === 'present_guidance');
    expect(guidance?.description).toContain('you have no character of your own');
    for (const { text } of all) {
      expect(text.toLowerCase()).not.toContain('vera');
      expect(text.toLowerCase()).not.toMatch(/you are [a-z]+,|sen [a-zçğıöşü]+'sin/);
    }
  });

  it('does not restate protocol the tool descriptions already carry', () => {
    // The prompt sets who the player is and which language to speak. The rules
    // live in the descriptions, where they reach every agent rather than one.
    for (const { text } of all) {
      expect(text).not.toContain('idempotencyKey');
      expect(text).not.toContain('basedOnStateVersion');
      expect(text).not.toContain('stateVersion');
    }
  });
});
