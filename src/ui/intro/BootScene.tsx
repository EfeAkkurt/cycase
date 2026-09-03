import { useEffect, useState } from 'react';

import { useGameSelector, useRuntime } from '../../app/gameContext';
import { useAudio } from '../../audio/audioContext';
import { useSpeech } from '../../audio/speechContext';
import { t } from '../../i18n';
import { useWebMcpStatus } from '../../webmcp/WebMcpPanel';
import { Button } from '../primitives';
import { AgentPromptCard } from './AgentPromptCard';
import { lobbyGate } from './lobbyGate';

/**
 * Boot — black screen. Nothing starts until the user opts in, so audio can
 * never autoplay and no timer runs behind an unattended tab.
 */
export function BootScene() {
  const runtime = useRuntime();
  const audio = useAudio();
  const speech = useSpeech();
  const mcp = useWebMcpStatus();

  /*
   * The honest signal, and not `agentStatus`: registration sets that to
   * `connected` on load in any capable browser, with or without anybody on the
   * other end. A tool call carrying `origin: 'agent'` is the first moment an
   * agent has demonstrably arrived.
   */
  const agentActed = useGameSelector((ctx) =>
    ctx.toolLog.some((entry) => entry.origin === 'agent'),
  );

  const [waitedMs, setWaitedMs] = useState(0);
  const gate = lobbyGate({
    supported: mcp.supported,
    toolsRegistered: mcp.registered,
    agentActed,
    waitedMs,
  });

  /*
   * One second is plenty: the only threshold is `MANUAL_ESCAPE_MS`, and a
   * tighter interval would re-render the lobby for no visible change. The
   * interval clears itself once the gate is open, so an idle lobby is not
   * ticking forever.
   */
  useEffect(() => {
    if (gate.canEnter) return;
    const started = Date.now();
    const id = window.setInterval(() => setWaitedMs(Date.now() - started), 1000);
    return () => window.clearInterval(id);
  }, [gate.canEnter]);

  // The only place audio is created. Both controls are real user gestures, so
  // the context can never be constructed speculatively and trip an autoplay
  // warning (docs/PRODUCT_SPEC.md: "audio begins only after user interaction").
  const enter = (skip: boolean) => {
    audio.unlock();
    /*
     * The same gesture opens narration. From here on every accepted line is
     * spoken automatically — the player never has to find a control to hear it
     * (`NODELESS_SOC_REDESIGN_2026-08-31.md` §7).
     *
     * The director also arms itself from the first pointer or key event on the
     * document, so this call is belt to that brace: it makes the intended path
     * explicit and independent of listener ordering, and it is idempotent, so
     * the two cannot double-arm.
     */
    speech.activate();
    audio.play('confirm');
    runtime.send({ type: skip ? 'SKIP_INTRO' : 'ENTER' });
  };

  return (
    <main className="scene" id="main">
      <div className="scene__inner">
        <h1 className="scene__title">{t('app.title')}</h1>
        <p className="prose muted">{t('app.tagline')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button
            variant="primary"
            onClick={() => enter(false)}
            disabled={!gate.canEnter}
            /*
             * The reason has to name the actual blocker. Until the seven
             * descriptors are registered the lobby is waiting on itself, and
             * telling the player it is waiting for an agent sends them looking
             * for a problem on the other end that does not exist yet.
             */
            reason={
              gate.canEnter
                ? undefined
                : t(
                    gate.phase === 'waiting_tools'
                      ? 'app.lobby.gate_reason_tools'
                      : 'app.lobby.gate_reason',
                  )
            }
          >
            {t('app.enter')}
          </Button>
          <Button variant="ghost" onClick={() => enter(true)} disabled={!gate.canEnter}>
            {t('app.skip_intro')}
          </Button>
        </div>
        <p className="muted text-sm">
          {t('app.enter_hint')}
        </p>

        {/*
         * What the shift is waiting for, said plainly. The gate exists because
         * this game is played *with* an agent; it never becomes a deadlock,
         * because a capable browser that nobody joins opens anyway and says so.
         */}
        <p className="muted text-sm" id="lobby-gate">
          {gate.phase === 'waiting_tools' ? t('app.lobby.waiting_tools') : null}
          {gate.phase === 'waiting_agent' && !gate.manualOffered
            ? t('app.lobby.waiting_agent')
            : null}
          {gate.manualOffered && gate.phase !== 'manual' ? t('app.lobby.escape') : null}
          {gate.phase === 'agent_here' ? t('app.lobby.agent_here') : null}
          {gate.phase === 'manual' ? t('app.lobby.manual') : null}
        </p>

        <AgentPromptCard />
      </div>
    </main>
  );
}
