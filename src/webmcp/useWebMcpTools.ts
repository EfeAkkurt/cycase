import { useEffect, useRef, useState } from 'react';

import {
  useRuntime,
} from '../app/gameContext';
import type { CommandKind } from '../game/types';
import { withGuidanceDelivery } from './guidanceReceipt';
import {
  describePage,
  officeSubSceneOf,
  pageReserve,
  withPageContext,
} from './pageContext';
import { TOOL_DEFINITIONS, compactResult } from './tools';
import { getModelContext, type ToolExecuteResult } from './types';

/** Case calls that mean the agent has started working, rather than just reading. */
const CASE_WORK = new Set<CommandKind>([
  'inspect_artifact',
  'run_diagnostic',
  'submit_decision',
  'take_response_action',
]);

/** Office beats where the player already has the console control in front of them. */
const HANDS_OVER = new Set(['assistantReporting', 'briefingChoice', 'explained', 'resume']);

/**
 * Bring the player to the console when the agent starts working the case.
 *
 * The proposal model needs the player somewhere they can answer it: `Approve`
 * lives on the console, and an agent working while the player is still at the
 * desk leaves a proposal with nobody able to take it. This sends the same
 * `DEBUG` the office's own "Open response console" button sends — the scene
 * only. It deliberately does not touch the route: the receipt already surfaces
 * an agent's call at the control that issued it, which is a better answer than
 * moving the view, and this is only about being in the room at all.
 *
 * Reads and narration never reach here, and neither does a refused call. Nor
 * does anything before the player has the console control in front of them:
 * `DEBUG` sits on the office node so the skip path can bypass the choreography,
 * and reusing that hatch earlier would let a tool call teleport the player past
 * the alarm and VERA's arrival — which is exactly what `get_incident.page`
 * promises the agent it will ask them to do instead.
 */
function openConsoleForAgentWork(
  runtime: ReturnType<typeof useRuntime>,
  kind: CommandKind,
  result: { ok: boolean },
): void {
  if (!result.ok || !CASE_WORK.has(kind)) return;
  if (runtime.scene !== 'office') return;
  const sub = officeSubSceneOf(runtime.actor.getSnapshot().value);
  if (sub === null || !HANDS_OVER.has(sub)) return;
  runtime.send({ type: 'DEBUG' });
}

export interface WebMcpStatus {
  /** The browser exposes `document.modelContext.registerTool`. */
  supported: boolean;
  /** Registration completed without throwing. */
  registered: boolean;
  toolNames: string[];
  error: string | null;
}

/** How long the "agent working" indicator stays lit after a tool call. */
const AGENT_BUSY_MS = 1200;

/**
 * Registers the seven CYCASE tools on the top-level document.
 *
 * The loop is generic over `TOOL_DEFINITIONS` and dispatches straight into the
 * engine's command seam, so the seventh tool — `present_guidance` — needs no
 * special case here. That is deliberate: narration is registered, executed,
 * validated, logged and reported through exactly the same path as a containment
 * action, and it is the *engine* that decides it cannot move the game. A
 * privileged path here would be a second place for that rule to be wrong.
 *
 * Lifetime: registered once for the life of the page and torn down with a
 * single `AbortController` on unmount. Tools are *not* registered per route.
 * Signal-based unregistration is Chrome 153+, while QA targets Chrome 149+, so
 * per-route controllers would silently shrink the tool set on the older target.
 * Instead every tool gates itself on live state and returns ACTION_NOT_ALLOWED
 * with a recovery string. See docs/WEBMCP_CONTRACT.md, "Tool Lifecycle".
 */
export function useWebMcpTools(): WebMcpStatus {
  const runtime = useRuntime();
  const [status, setStatus] = useState<WebMcpStatus>({
    supported: false,
    registered: false,
    toolNames: [],
    error: null,
  });
  const busyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) {
      setStatus({ supported: false, registered: false, toolNames: [], error: null });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const markBusy = () => {
      runtime.send({ type: 'SET_AGENT_STATUS', status: 'working' });
      window.clearTimeout(busyTimer.current);
      busyTimer.current = window.setTimeout(() => {
        runtime.send({ type: 'SET_AGENT_STATUS', status: 'connected' });
      }, AGENT_BUSY_MS);
    };

    const register = async () => {
      const registered: string[] = [];
      const failures: string[] = [];

      // Registered one at a time and tracked individually. A single rejected
      // descriptor must not make the other six working tools invisible, and it must not
      // be reported as "this browser has no WebMCP" — those are very different
      // problems and they look identical if the whole loop is one try block.
      for (const tool of TOOL_DEFINITIONS) {
        try {
          await modelContext.registerTool(
            {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
              execute: (input, options): ToolExecuteResult => {
                // Honour cancellation before touching game state, so an aborted
                // call can never leave a late mutation behind.
                if (options?.signal?.aborted || controller.signal.aborted) {
                  return {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          ok: false,
                          stateVersion: runtime.stateVersion,
                          error: { code: 'ACTION_NOT_ALLOWED', message: 'Call aborted.' },
                        }),
                      },
                    ],
                    isError: true,
                  };
                }

                markBusy();
                const result = runtime.execute(tool.name as CommandKind, input ?? {}, 'agent');

                /*
                 * The contract's delivery fields are presentation facts, so they
                 * are merged here rather than in the engine — see
                 * `guidanceReceipt.ts` for why putting them in the stored result
                 * would break the backend's replay verification.
                 */
                const payload =
                  tool.name === 'present_guidance'
                    ? withGuidanceDelivery(result, runtime.context)
                    : result;

                /*
                 * `get_incident` also says where the player is. The token is
                 * merged *after* compaction with its size reserved, so the clip
                 * passes can never reach it — see `pageContext.ts`.
                 */
                openConsoleForAgentWork(runtime, tool.name as CommandKind, result);

                const page =
                  tool.name === 'get_incident'
                    ? describePage(
                        runtime.scene,
                        officeSubSceneOf(runtime.actor.getSnapshot().value),
                      )
                    : null;
                const wire = page
                  ? withPageContext(compactResult(payload, pageReserve(page)), page)
                  : compactResult(payload);

                return {
                  content: [{ type: 'text', text: JSON.stringify(wire) }],
                  isError: !result.ok,
                };
              },
            },
            { signal: controller.signal },
          );
          registered.push(tool.name);
        } catch (error) {
          failures.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (cancelled) return;
      if (registered.length > 0) {
        runtime.send({ type: 'SET_AGENT_STATUS', status: 'connected' });
      }
      setStatus({
        supported: true,
        registered: registered.length === TOOL_DEFINITIONS.length,
        toolNames: registered,
        error: failures.length > 0 ? failures.join('; ') : null,
      });
    };

    void register();

    return () => {
      cancelled = true;
      window.clearTimeout(busyTimer.current);
      controller.abort();
    };
  }, [runtime]);

  return status;
}
