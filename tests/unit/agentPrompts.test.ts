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
      expect(text.length, `${mode}/${language}`).toBeLessThanOrEqual(750);
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

  it('names the agent in the chat and keeps that name off the page', () => {
    // VERA is the only assistant in the room. Deniz is on a phone line, outside
    // the fiction — so the prompt has to carry the boundary the caption relies
    // on, and the tool description has to agree with it.
    const guidance = TOOL_DEFINITIONS.find((tool) => tool.name === 'present_guidance');
    expect(guidance?.description).toContain('this channel carries no name at all');
    expect(guidance?.description).toContain('do not open with a name');

    for (const { language, text } of all) {
      expect(text).toContain('Deniz');
      if (language === 'en') {
        expect(text).toContain('not in the room');
        expect(text).toContain('never speak');
        expect(text).toContain('no name on the line you send to the page');
        expect(text).toContain('call me Chief');
      } else {
        expect(text).toContain('Odada değilsin');
        expect(text).toContain('VERA’nın yerine konuşma');
        expect(text).toContain('isim koyma');
        expect(text).toContain('bana Şef de');
      }
      expect(text.toLowerCase()).not.toMatch(/sen vera|you are vera/);
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
