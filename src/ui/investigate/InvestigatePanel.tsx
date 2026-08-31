import { useGame, useRuntime } from '../../app/gameContext';
import { INVESTIGATE_TAB_META, tabRowCount } from '../../game/investigate';
import type { InvestigateTab } from '../../game/types';
import { t } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Panel, Tabs, tabId } from '../primitives';
import { ConsoleStatus, FocusBar } from './ConsoleBar';
import { EmailTool } from './EmailTool';
import { EndpointTool } from './EndpointTool';
import { IdentityTool } from './IdentityTool';
import { NetworkTool } from './NetworkTool';
import { SiemTool } from './SiemTool';

/**
 * The Investigate destination: one shell, five vendor-neutral tools.
 *
 * Which tool is open lives in the case context, not in local React state, for
 * one reason: an office monitor has to be able to say "open Investigate on
 * Identity" from a scene the console is not mounted in yet, and that intent has
 * to survive the crossfade (§5, §10). `tab` overrides the context selection for
 * a surface that is *showing* a tool rather than *choosing* one — the right-hand
 * monitor renders Identity without moving the operator's console.
 */
export function InvestigatePanel({
  mode = 'full',
  tab,
}: {
  mode?: PanelMode;
  /** Render this tool instead of the operator's current selection. */
  tab?: InvestigateTab;
}) {
  const ctx = useGame();
  const runtime = useRuntime();
  const active = tab ?? ctx.investigateTab;
  const meta = INVESTIGATE_TAB_META.find((entry) => entry.id === active);

  const tool = <InvestigateTool tab={active} mode={mode} />;

  if (mode === 'compact') {
    // At monitor distance the tab strip is a label, not a control: the surface
    // is showing one tool, and the choice belongs to the console.
    return (
      <Panel
        id="investigate-compact"
        title={meta ? t(meta.labelKey) : t('investigate.title')}
        compact
        headingLevel={3}
      >
        {tool}
      </Panel>
    );
  }

  return (
    <Panel
      id="investigate-panel"
      title={t('investigate.title')}
      actions={
        <Tabs
          idBase="investigate"
          label={t('investigate.tools')}
          value={active}
          onChange={(next) => runtime.send({ type: 'SET_INVESTIGATE_TAB', tab: next })}
          options={INVESTIGATE_TAB_META.map((entry) => ({
            id: entry.id,
            label: t(entry.labelKey),
            badge: String(tabRowCount(ctx, entry.id)),
          }))}
        />
      }
    >
      {/*
       * The console bar: what is being ingested, and what is being followed.
       *
       * Above the tool rather than inside it, because both facts are true of
       * the whole console — a pivot from SIEM to Endpoint must not look like a
       * different application with a different idea of what is selected.
       */}
      <div className="console-bar">
        <ConsoleStatus />
        <FocusBar />
      </div>

      <div
        id="investigate-tool"
        role="tabpanel"
        aria-labelledby={tabId('investigate', active)}
        tabIndex={-1}
      >
        {tool}
      </div>
    </Panel>
  );
}

function InvestigateTool({ tab, mode }: { tab: InvestigateTab; mode: PanelMode }) {
  switch (tab) {
    case 'siem':
      return <SiemTool mode={mode} />;
    case 'identity':
      return <IdentityTool mode={mode} />;
    case 'endpoint':
      return <EndpointTool mode={mode} />;
    case 'network':
      return <NetworkTool mode={mode} />;
    case 'email':
      return <EmailTool mode={mode} />;
  }
}
