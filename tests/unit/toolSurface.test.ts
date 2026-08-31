import { describe, expect, it } from 'vitest';

import { TOOL_DEFINITIONS } from '../../src/webmcp/tools';
import { COMMAND_KINDS } from '../../src/game/types';

/**
 * The tool surface is a contract, and it is pinned here rather than only in a browser.
 *
 * `webmcp-native.spec.ts` and `webmcp.spec.ts` already prove seven tools reach a real
 * `document.modelContext`. Both need a browser, and one needs installed Chrome with
 * WebMCP flags and a GPU — so on a machine that cannot run them, a rename or a
 * quietly-dropped eighth tool would land with nothing complaining. This file is the
 * cheap half of that guard: it runs in `vitest`, it names the seven tools literally,
 * and it fails on a rename rather than on a count.
 *
 * The names are written out as string literals on purpose. Deriving them from
 * `TOOL_DEFINITIONS` would make the test agree with any edit to the thing it guards.
 */
const CONTRACT_TOOLS = [
  'get_incident',
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
  'request_hint',
  'present_guidance',
] as const;

describe('the registered WebMCP tool surface', () => {
  it('is exactly the seven contract tools, by name', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([...CONTRACT_TOOLS].sort());
  });

  it('exposes no tool that is not backed by an engine command', () => {
    // Tool names mirror internal command kinds one-to-one. That is what makes "UI
    // buttons and WebMCP tools call the same domain actions" structural rather than
    // aspirational, so a tool with no matching command would be a second, unrefereed
    // path into the game.
    for (const tool of TOOL_DEFINITIONS) {
      expect(COMMAND_KINDS, `${tool.name} has no engine command`).toContain(tool.name);
    }
    expect(TOOL_DEFINITIONS).toHaveLength(COMMAND_KINDS.length);
  });

  it('offers no generic browser-automation tool', () => {
    /*
     * The whole argument for site tools over click-and-screenshot automation is that
     * the page stays the referee. A generic click, chat, screenshot or navigation tool
     * would hand that back and make the seven refereed tools optional, so the absence
     * is asserted rather than left to review.
     */
    const forbidden = [
      'click', 'tap', 'type', 'press', 'screenshot', 'snapshot', 'capture',
      'navigate', 'goto', 'scroll', 'chat', 'prompt', 'eval',
    ];
    for (const tool of TOOL_DEFINITIONS) {
      for (const word of forbidden) {
        expect(tool.name.split('_'), `${tool.name} looks like generic automation`).not.toContain(
          word,
        );
      }
    }
  });

  it('annotates only the genuinely read-only tools, and only with the two defined hints', () => {
    const readOnly = TOOL_DEFINITIONS.filter((tool) => tool.annotations.readOnlyHint).map(
      (tool) => tool.name,
    );
    // `present_guidance` is deliberately not read-only: it appends to the narrative
    // log. See the comment on its definition in `tools.ts`.
    expect(readOnly.sort()).toEqual(['get_incident', 'request_hint']);

    const untrusted = TOOL_DEFINITIONS.filter((tool) => tool.annotations.untrustedContentHint).map(
      (tool) => tool.name,
    );
    expect(untrusted).toEqual(['inspect_artifact']);

    for (const tool of TOOL_DEFINITIONS) {
      expect(Object.keys(tool.annotations).sort()).toEqual(
        Object.keys(tool.annotations)
          .filter((key) => key === 'readOnlyHint' || key === 'untrustedContentHint')
          .sort(),
      );
    }
  });

  it('gives every tool a description an agent could act on', () => {
    for (const tool of TOOL_DEFINITIONS) {
      // Names and descriptions are the agent's only documentation.
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(80);
      expect(tool.inputSchema, `${tool.name} schema`).toBeTruthy();
    }
  });
});
