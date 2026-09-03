import { describe, expect, it } from 'vitest';

import { MANUAL_ESCAPE_MS, lobbyGate } from '../../src/ui/intro/lobbyGate';

/**
 * The lobby gate decides one thing: whether the shift can start. It is a pure
 * function so the decision can be read here rather than inferred from a
 * disabled button in a browser.
 */
const base = { supported: true, toolsRegistered: true, agentActed: false, waitedMs: 0 };

describe('lobbyGate', () => {
  it('lets a browser with no site tools straight in', () => {
    expect(lobbyGate({ ...base, supported: false })).toEqual({
      phase: 'manual',
      canEnter: true,
      manualOffered: true,
    });
  });

  it('does not open on registration alone', () => {
    // The page registers its own tools on load. That says nothing about an
    // agent, and treating it as arrival is the bug this gate closes.
    expect(lobbyGate(base)).toEqual({
      phase: 'waiting_agent',
      canEnter: false,
      manualOffered: false,
    });
  });

  it('distinguishes waiting for tools from waiting for an agent', () => {
    expect(lobbyGate({ ...base, toolsRegistered: false }).phase).toBe('waiting_tools');
    expect(lobbyGate(base).phase).toBe('waiting_agent');
  });

  it('opens as soon as an agent has actually called a tool', () => {
    expect(lobbyGate({ ...base, agentActed: true })).toEqual({
      phase: 'agent_here',
      canEnter: true,
      manualOffered: false,
    });
  });

  it('never deadlocks: a capable browser with no agent is let in eventually', () => {
    expect(lobbyGate({ ...base, waitedMs: MANUAL_ESCAPE_MS - 1 }).canEnter).toBe(false);
    const escaped = lobbyGate({ ...base, waitedMs: MANUAL_ESCAPE_MS });
    expect(escaped.canEnter).toBe(true);
    expect(escaped.manualOffered).toBe(true);
    // Still honest about why it opened.
    expect(escaped.phase).toBe('waiting_agent');
  });

  it('an arriving agent outranks the escape hatch', () => {
    const both = lobbyGate({ ...base, agentActed: true, waitedMs: MANUAL_ESCAPE_MS * 2 });
    expect(both.phase).toBe('agent_here');
    expect(both.manualOffered).toBe(false);
  });
});
