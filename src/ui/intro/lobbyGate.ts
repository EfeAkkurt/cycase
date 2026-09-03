/**
 * What the lobby is waiting for.
 *
 * The distinction the whole file exists for: `waiting_agent` is a browser that
 * has registered all seven tools and still has nobody on the other end.
 * Registration is the page's own doing — it happens on load, in any capable
 * browser, with or without an agent attached — so it cannot be the signal that
 * opens the gate. `agent_here` is reached only when a tool has actually been
 * called with `origin: 'agent'`.
 */
export type LobbyPhase = 'waiting_tools' | 'waiting_agent' | 'agent_here' | 'manual';

export interface LobbyGateInput {
  /** `document.modelContext.registerTool` exists. */
  supported: boolean;
  /** All seven descriptors registered without throwing. */
  toolsRegistered: boolean;
  /** An agent has called at least one tool. The honest signal. */
  agentActed: boolean;
  /** Milliseconds the lobby has been waiting. */
  waitedMs: number;
}

export interface LobbyGate {
  phase: LobbyPhase;
  /** `Enter Simulation` is operable. */
  canEnter: boolean;
  /** Offer — and explain — the play-without-an-agent path. */
  manualOffered: boolean;
}

/**
 * How long a capable browser waits before it offers the manual path anyway.
 *
 * The boundary is absolute: the case stays fully playable without WebMCP. A
 * browser that supports it but has no agent attached is the case the
 * unsupported branch misses, and without this the gate is a deadlock.
 */
export const MANUAL_ESCAPE_MS = 60_000;

export function lobbyGate(input: LobbyGateInput): LobbyGate {
  const { supported, toolsRegistered, agentActed, waitedMs } = input;

  if (!supported) {
    return { phase: 'manual', canEnter: true, manualOffered: true };
  }

  if (agentActed) {
    return { phase: 'agent_here', canEnter: true, manualOffered: false };
  }

  const escaped = waitedMs >= MANUAL_ESCAPE_MS;

  return {
    phase: toolsRegistered ? 'waiting_agent' : 'waiting_tools',
    canEnter: escaped,
    manualOffered: escaped,
  };
}
