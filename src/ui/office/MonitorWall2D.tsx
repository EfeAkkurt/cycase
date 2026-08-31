import type { MouseEvent } from 'react';

import { useAudio } from '../../audio/audioContext';
import { useGameSelector, useRuntime } from '../../app/gameContext';
import { nextRequiredStep } from '../../game/selectors';
import type { DashboardRoute, GameContext, InvestigateTab } from '../../game/types';
import { t } from '../../i18n';
import { EndpointTool } from '../investigate/EndpointTool';
import { IdentityTool } from '../investigate/IdentityTool';
import { SiemTool } from '../investigate/SiemTool';
import { IncidentPanel } from '../panels/IncidentPanel';
import { TelemetryPanel } from '../panels/TelemetryPanel';
import { Button, Panel } from '../primitives';

/**
 * The three office monitors, as three operational tools.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §5 is a contract about *content*,
 * not about geometry: left is the SIEM live event stream, centre is incident
 * command and carries the alarm, right is the contextual investigation tool.
 * Before this the right monitor drew the dashboard's topology graph and the left
 * drew telemetry alone, which made two of the three screens a second view of the
 * Command page rather than the tools an analyst would actually have open.
 *
 * Everything here is the *same* React component the response console renders, in
 * its `compact` mode — no second store, no duplicate dataset, no screenshot
 * texture. That is also why this file describes the monitors instead of merely
 * drawing them: the WebGL office and the flat wall both mount these descriptors,
 * so the label a screen reader hears, the tool that is drawn and the console
 * route the surface opens cannot drift apart between the two paths.
 *
 * It lives beside `Office.tsx` rather than inside `Office3D.tsx` on purpose.
 * `Office.tsx` needs the flat wall eagerly — it is the Suspense fallback while
 * the room's chunk loads — and importing it from the lazy 3D module would drag
 * three.js into the chunk the 2D path exists to avoid.
 */

export type MonitorId = 'left' | 'center' | 'right';

/** The tools the right-hand monitor is allowed to be. */
type ContextualTab = Extract<InvestigateTab, 'identity' | 'endpoint'>;

interface OfficeMonitor {
  id: MonitorId;
  /** What the surface is. The group's accessible name. */
  name: string;
  /** Where activating the surface lands in the response console. */
  route: DashboardRoute;
  /** Only the two Investigate monitors carry one; Command has no tool tab. */
  tab?: InvestigateTab;
  /** The label on the control that opens it — which names the tool, not "here". */
  open: string;
}

/**
 * Which investigation tool the right-hand monitor is showing.
 *
 * §5 makes this the contextual screen — Identity for Case 001, switching to
 * Endpoint/EDR "when the current step makes that source relevant". Relevance is
 * read from `nextRequiredStep`, the same selector the console's own guided card
 * reads, so this monitor cannot drift away from what the player is being asked
 * to do next. The two commands below are the whole of Case 001's endpoint work:
 * the EDR report, and the isolation that follows it.
 *
 * Network and Email are deliberately unreachable here. This is one screen at
 * monitor distance, and a surface that could be any of four tools stops being a
 * place the player knows to look.
 */
function contextualTab(ctx: GameContext): ContextualTab {
  const step = nextRequiredStep(ctx);
  if (!step) return 'identity';

  const endpointWork = step.pending.some((command) => {
    if (command.kind === 'take_response_action') return command.actionId === 'isolate_endpoint';
    if (command.kind === 'inspect_artifact') return command.artifactId === 'art_edr_001';
    return false;
  });

  return endpointWork ? 'endpoint' : 'identity';
}

/**
 * `useGameSelector` rather than `useGame`, for the reason `useStableGame` exists
 * a few files over: the live clock publishes a new context every second, and
 * three projected monitors re-rendering on a clock nothing here reads would be a
 * frame-budget cost with no visible effect. This subscription only wakes when
 * the tool the right monitor should show actually changes.
 */
function useMonitors(): Record<MonitorId, OfficeMonitor> {
  const tab = useGameSelector(contextualTab);

  return {
    left: {
      id: 'left',
      name: t('monitor.left.name'),
      route: 'investigate',
      tab: 'siem',
      open: t('monitor.open', { tool: t('monitor.tool.siem') }),
    },
    center: {
      id: 'center',
      name: t('monitor.center.name'),
      route: 'command',
      open: t('monitor.open', { tool: t('monitor.tool.command') }),
    },
    right: {
      id: 'right',
      name: t(`monitor.right.name.${tab}`),
      route: 'investigate',
      tab,
      open: t('monitor.open', { tool: t(`monitor.tool.${tab}`) }),
    },
  };
}

/**
 * The interface on one monitor.
 *
 * The left screen carries two panels because §5 asks that surface for both the
 * live anomaly trend and the top matching events, and the product already has a
 * component for each: the trend is `TelemetryPanel` in compact mode, which draws
 * its own hand-rolled SVG rather than pulling the charting library into the
 * office, and the events are the SIEM tool's compact rows. Stacked, those two
 * are what a SIEM overview screen is; either alone is half of the contract.
 *
 * Every panel here is laid out against the fixed DOM surface the projection maps
 * onto the glass — 520x306 for the side screens, 570x333 for the centre
 * (`three/layout.ts`). That box does not change with the viewport; only the
 * scale from box to glass does. So 1280x720 and 1440x900 are the same layout
 * problem, and `.monitor-surface__tools` solves it once: the trend takes the
 * height it needs, and the rows below it clip themselves rather than pushing it
 * off the top of the screen.
 */
function MonitorBody({
  monitor,
  onAcknowledgeAlarm,
}: {
  monitor: OfficeMonitor;
  onAcknowledgeAlarm?: () => void;
}) {
  if (monitor.id === 'left') {
    return (
      <>
        <TelemetryPanel mode="compact" />
        <Panel id="monitor-siem" title={t('investigate.tab.siem')} compact headingLevel={3}>
          <SiemTool mode="compact" />
        </Panel>
      </>
    );
  }

  if (monitor.id === 'center') {
    return <IncidentPanel mode="compact" onAcknowledgeAlarm={onAcknowledgeAlarm} />;
  }

  const tab: ContextualTab = monitor.tab === 'endpoint' ? 'endpoint' : 'identity';

  return (
    <Panel id="monitor-investigate" title={t(`investigate.tab.${tab}`)} compact headingLevel={3}>
      {tab === 'endpoint' ? <EndpointTool mode="compact" /> : <IdentityTool mode="compact" />}
    </Panel>
  );
}

/**
 * One monitor: its interface, and the control that opens it in the console.
 *
 * §5 and §10 want the screen itself to open the tool it is showing, from the
 * pointer and from the keyboard. The old wrapper was a `<div role="group">` with
 * no `tabIndex` and no handler, so a keyboard player could read all three
 * monitors and reach none of them.
 *
 * Three things about the implementation are load-bearing.
 *
 * The first is that the activation is a real `<button>` *inside* the surface
 * rather than `role="button"` on the surface itself. The obvious version — make
 * the whole panel the control — is wrong twice over. `role="button"` is a widget
 * role whose children are presentational, so the incident brief, the event rows
 * and the session table would all stop being readable by a screen reader in
 * exchange for one label; and while the alarm is unacknowledged the centre
 * surface already contains a button of its own, which would be a
 * nested-interactive violation. A native button keeps the panel readable, gets
 * Enter and Space without a keydown handler, and cannot be got wrong later. The
 * surface stays clickable for the pointer, because a monitor you can click is
 * the whole metaphor — the guard below is what keeps that from swallowing the
 * controls inside it.
 *
 * The second is the order of the two events. `SET_ROUTE` is registered at the
 * machine root and is a bare context assign: it records the intent and leaves the
 * camera exactly where it is. The office is left by `DEBUG`. So sending only
 * `SET_ROUTE` does nothing a player can see, and sending only `DEBUG` opens the
 * console on whichever route was last used. Both, in that order, are one intent —
 * and because route and tab live in the case context rather than in scene state,
 * they survive the crossfade and the dashboard -> office -> dashboard round trip
 * §10 asks for.
 *
 * The third is that nothing here activates while the alarm is unacknowledged.
 * That is the P0.2 staging the centre monitor exists to enforce: nothing happens
 * until the alarm is dealt with, and a screen that could throw the player into
 * the console first would undo it.
 */
function MonitorSurface({
  monitor,
  className,
  alert,
  onAcknowledgeAlarm,
}: {
  monitor: OfficeMonitor;
  className?: string;
  /** The alarm is unacknowledged: the surfaces show, and do not act. */
  alert: boolean;
  onAcknowledgeAlarm?: () => void;
}) {
  const runtime = useRuntime();
  const audio = useAudio();

  const activate = () => {
    audio.play('confirm');
    runtime.send({ type: 'SET_ROUTE', route: monitor.route, tab: monitor.tab });
    runtime.send({ type: 'DEBUG' });
  };

  /*
   * Never swallow a control that lives inside the panel — starting with the
   * open button itself, whose own click would otherwise bubble up to here and
   * run the transition twice.
   */
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    activate();
  };

  return (
    <div
      className={['monitor-surface', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={monitor.name}
      onClick={alert ? undefined : onClick}
    >
      <div className="monitor-surface__tools">
        <MonitorBody monitor={monitor} onAcknowledgeAlarm={onAcknowledgeAlarm} />
      </div>

      {alert ? null : (
        <Button
          size="sm"
          variant="ghost"
          block
          className="monitor-open"
          /* What this control opens, as a fact QA can read rather than infer. */
          data-monitor-opens={monitor.tab ? `${monitor.route}:${monitor.tab}` : monitor.route}
          onClick={activate}
        >
          {monitor.open}
        </Button>
      )}
    </div>
  );
}

/**
 * The 3D office's per-screen surface, rendered inside the projected element.
 *
 * Exported rather than duplicated so the WebGL path and the flat wall cannot
 * disagree about what a monitor is: same descriptor, same tool, same route.
 */
export function MonitorSurface3D({
  id,
  className,
  alert,
  onAcknowledgeAlarm,
}: {
  id: MonitorId;
  className: string;
  alert: boolean;
  onAcknowledgeAlarm?: () => void;
}) {
  const monitors = useMonitors();

  return (
    <MonitorSurface
      monitor={monitors[id]}
      className={className}
      alert={alert}
      onAcknowledgeAlarm={onAcknowledgeAlarm}
    />
  );
}

/**
 * Flat monitor wall: the 3D-disabled and small-viewport path, and the Suspense
 * fallback while the room's chunk is still loading.
 *
 * The same three tools with the same three activation controls. The office is
 * not a 3D feature with a degraded twin — the acceptance gates ask for the 2D
 * fallback to complete the case, and "opens the correct full tool" is part of
 * completing it.
 */
export function MonitorWall2D({
  unacknowledged,
  onAcknowledge,
}: {
  unacknowledged: boolean;
  onAcknowledge: () => void;
}) {
  const monitors = useMonitors();

  return (
    <section className="monitors" aria-label={t('fallback.title')}>
      <MonitorSurface monitor={monitors.left} alert={unacknowledged} />
      <MonitorSurface
        monitor={monitors.center}
        className={unacknowledged ? 'office3d__surface--alarm' : undefined}
        alert={unacknowledged}
        onAcknowledgeAlarm={unacknowledged ? onAcknowledge : undefined}
      />
      <MonitorSurface monitor={monitors.right} alert={unacknowledged} />
    </section>
  );
}
