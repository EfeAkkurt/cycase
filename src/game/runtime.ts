import type { Actor } from 'xstate';

import type { gameMachine } from './machine';
import type {
  ArtifactId,
  CallOrigin,
  CommandKind,
  DecisionId,
  DecisionOptionId,
  DiagnosticId,
  GameCommand,
  GameContext,
  HintTopic,
  ResponseActionId,
  SceneId,
  ToolResult,
} from './types';

export type GameActor = Actor<typeof gameMachine>;

/**
 * The one object both the dashboard and the WebMCP tool layer talk to.
 *
 * XState `send` is synchronous for immediate transitions, so a command is fully
 * applied by the time `send` returns. `execute` reads the result straight back
 * out of context and asserts on the sequence number, which turns any future
 * asynchrony into a loud failure instead of a silently mismatched result.
 */
export class GameRuntime {
  /** Public so React can subscribe with `useSelector` for fine-grained reads. */
  readonly actor: GameActor;

  constructor(actor: GameActor) {
    this.actor = actor;
  }

  get context(): GameContext {
    return this.actor.getSnapshot().context;
  }

  get scene(): SceneId {
    const value = this.actor.getSnapshot().value;
    return (typeof value === 'string' ? value : Object.keys(value)[0]) as SceneId;
  }

  get stateVersion(): number {
    return this.context.stateVersion;
  }

  /** Raw command path. WebMCP tools use this with agent-supplied arguments. */
  execute(kind: CommandKind, input: unknown, origin: CallOrigin): ToolResult {
    const expectedSeq = this.context.seq + 1;
    this.actor.send({
      type: 'COMMAND',
      command: { kind, input, origin } as unknown as GameCommand,
    });

    const result = this.context.lastResult;
    if (!result || result.seq !== expectedSeq) {
      // Should be unreachable: it would mean a command was dropped or the
      // transition became asynchronous. Fail loudly rather than return a
      // result that belongs to a different call.
      return {
        ok: false,
        stateVersion: this.stateVersion,
        error: {
          code: 'ACTION_NOT_ALLOWED',
          message: 'The game machine did not apply this command.',
          recovery: 'Reload the page and restart the case.',
        },
      };
    }

    const { seq: _seq, ...rest } = result;
    return rest;
  }

  /* ---------------- convenience wrappers for the human UI ----------------
   * The dashboard never has to reason about stateVersion or idempotency: it
   * reads the live version and derives a stable key, so a double-click replays
   * instead of applying twice — the same protection the agent gets.
   */

  getIncident(origin: CallOrigin = 'human'): ToolResult {
    return this.execute('get_incident', {}, origin);
  }

  inspectArtifact(artifactId: ArtifactId, origin: CallOrigin = 'human'): ToolResult {
    return this.execute(
      'inspect_artifact',
      { artifactId, stateVersion: this.stateVersion },
      origin,
    );
  }

  runDiagnostic(diagnosticId: DiagnosticId, origin: CallOrigin = 'human'): ToolResult {
    return this.execute(
      'run_diagnostic',
      { diagnosticId, stateVersion: this.stateVersion },
      origin,
    );
  }

  takeResponseAction(actionId: ResponseActionId, origin: CallOrigin = 'human'): ToolResult {
    return this.execute(
      'take_response_action',
      {
        actionId,
        stateVersion: this.stateVersion,
        idempotencyKey: `ui:action:${actionId}`,
      },
      origin,
    );
  }

  submitDecision(
    decisionId: DecisionId,
    optionId: DecisionOptionId,
    origin: CallOrigin = 'human',
  ): ToolResult {
    return this.execute(
      'submit_decision',
      {
        decisionId,
        optionId,
        stateVersion: this.stateVersion,
        idempotencyKey: `ui:decision:${decisionId}`,
      },
      origin,
    );
  }

  requestHint(topic: HintTopic, origin: CallOrigin = 'human'): ToolResult {
    return this.execute('request_hint', { topic, stateVersion: this.stateVersion }, origin);
  }

  /* ---------------- scene events ---------------- */

  send(event: Parameters<GameActor['send']>[0]): void {
    this.actor.send(event);
  }

  subscribe(listener: () => void): { unsubscribe: () => void } {
    return this.actor.subscribe(listener);
  }
}
