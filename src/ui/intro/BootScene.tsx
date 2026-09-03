import { useRuntime } from '../../app/gameContext';
import { useAudio } from '../../audio/audioContext';
import { useSpeech } from '../../audio/speechContext';
import { t } from '../../i18n';
import { Button } from '../primitives';
import { AgentPromptCard } from './AgentPromptCard';

/**
 * Boot — black screen. Nothing starts until the user opts in, so audio can
 * never autoplay and no timer runs behind an unattended tab.
 */
export function BootScene() {
  const runtime = useRuntime();
  const audio = useAudio();
  const speech = useSpeech();

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
          <Button variant="primary" onClick={() => enter(false)}>
            {t('app.enter')}
          </Button>
          <Button variant="ghost" onClick={() => enter(true)}>
            {t('app.skip_intro')}
          </Button>
        </div>
        <p className="muted text-sm">
          {t('app.enter_hint')}
        </p>

        <AgentPromptCard />
      </div>
    </main>
  );
}
