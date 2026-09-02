import { useRef, useState } from 'react';

import { t } from '../../i18n';
import { agentPrompt, type PromptLanguage, type PromptMode } from '../../webmcp/agentPrompts';
import { useWebMcpStatus } from '../../webmcp/WebMcpPanel';
import { Button } from '../primitives';

/**
 * "Start with your agent" — the lobby card that hands the player the prompt.
 *
 * The page cannot push text into the chat, so this is the whole mechanism: pick
 * a mode and a language, copy, paste. Without site tools it says where to open
 * the page instead, because a prompt is useless in a browser no agent is
 * listening to.
 *
 * Both toggles are plain buttons with `aria-pressed`, so a screen reader hears
 * "Learn, pressed" rather than a custom widget.
 */
export function AgentPromptCard() {
  const mcp = useWebMcpStatus();
  const [mode, setMode] = useState<PromptMode>('learn');
  const [language, setLanguage] = useState<PromptLanguage>('en');
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const text = agentPrompt(mode, language);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: leave the text selected so ⌘C still works.
      textRef.current?.focus();
      textRef.current?.select();
      setCopied(false);
    }
  };

  if (!mcp.supported) {
    return (
      <section className="prompt-card" id="agent-prompt" aria-labelledby="agent-prompt-title">
        <span className="eyebrow" id="agent-prompt-title">
          {t('prompt.title')}
        </span>
        <p className="prose muted text-sm">{t('prompt.unavailable')}</p>
      </section>
    );
  }

  return (
    <section className="prompt-card" id="agent-prompt" aria-labelledby="agent-prompt-title">
      <div className="prompt-card__head">
        <span className="eyebrow" id="agent-prompt-title">
          {t('prompt.title')}
        </span>
        <span className="text-xs muted">{t('prompt.body')}</span>
      </div>

      <div className="prompt-card__toggles">
        <div className="prompt-card__group" role="group" aria-label={t('prompt.mode')}>
          <Button
            size="sm"
            variant={mode === 'learn' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'learn'}
            onClick={() => setMode('learn')}
          >
            {t('prompt.mode.learn')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'solve' ? 'primary' : 'ghost'}
            aria-pressed={mode === 'solve'}
            onClick={() => setMode('solve')}
          >
            {t('prompt.mode.solve')}
          </Button>
        </div>
        <div className="prompt-card__group" role="group" aria-label={t('app.language')}>
          <Button
            size="sm"
            variant={language === 'en' ? 'primary' : 'ghost'}
            aria-pressed={language === 'en'}
            onClick={() => setLanguage('en')}
          >
            {t('app.lang.en')}
          </Button>
          <Button
            size="sm"
            variant={language === 'tr' ? 'primary' : 'ghost'}
            aria-pressed={language === 'tr'}
            onClick={() => setLanguage('tr')}
          >
            {t('app.lang.tr')}
          </Button>
        </div>
      </div>

      <p className="text-xs muted">
        {mode === 'learn' ? t('prompt.mode.learn_detail') : t('prompt.mode.solve_detail')}
      </p>

      <textarea
        ref={textRef}
        id="agent-prompt-text"
        className="prompt-card__text mono"
        readOnly
        rows={6}
        value={text}
        aria-label={t('prompt.text_label')}
        onFocus={(event) => event.currentTarget.select()}
      />

      <div className="row prompt-card__actions">
        <Button id="agent-prompt-copy" size="sm" variant="primary" onClick={copy}>
          {copied ? t('webmcp.copied') : t('prompt.copy')}
        </Button>
        <span className="text-xs muted">{t('prompt.site_tools_hint')}</span>
      </div>
    </section>
  );
}
