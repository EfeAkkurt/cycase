import { useEffect, useRef, useState } from 'react';

import {
  useCommand,
  useGame,
  useRuntime,
} from '../../app/gameContext';
import {
  ARTIFACT_BY_ID,
  CASE_ID,
  DIAGNOSTICS,
  DIAGNOSTIC_BY_ID,
  FINDINGS,
  INCIDENT_ID,
  RESPONSE_ACTIONS,
} from '../../game/fixtures/case001';
import { custodyRecord, sourceHealth } from '../../game/investigate';
import {
  CHRONOLOGY_ORIGINS,
  chronology,
  chronologyCounts,
  filterChronology,
  formatAge,
  type ChronologyOrigin,
} from '../../game/live';
import { diagnosticRows, previewEffects, verifyAction } from '../../game/sources';
import {
  actionAvailability,
  artifactAvailability,
  artifactsWithState,
  elapsedSeconds,
  formatElapsed,
  hasPerformed,
  hiddenTimelineCount,
  incidentStatus,
  inspectedCount,
  recommendedActions,
  unresolvedCriticalFindings,
  visibleAssets,
  visibleIdentities,
} from '../../game/selectors';
import { t, tk } from '../../i18n';
import type { ArtifactId, EvidenceView, ResponseActionId, TimelineOriginFilter } from '../../game/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  KeyValue,
  Panel,
  Tabs,
  UntrustedShell,
} from '../primitives';
import { InvestigatePanel } from '../investigate';
import { IncidentPanel } from '../panels/IncidentPanel';
import { TelemetryPanel } from '../panels/TelemetryPanel';
import { TopologyPanel } from '../panels/TopologyPanel';
import { CaseLogPanel } from './CaseLogPanel';
import { ContainmentChecklist } from './ContainmentChecklist';
import { DecisionCard } from './DecisionCard';
import { openEvidenceRecord } from './flow';
import { Receipt } from './Receipt';

/* ------------------------------------------------------------------ *
 * Command — the queue, the active incident and what it is costing
 * ------------------------------------------------------------------ */

export function CommandRoute() {
  return (
    <>
      <CaseQueue />
      <IncidentPanel mode="full" />
      <DecisionCard />
      <div className="grid-2">
        <ContainmentChecklist />
        <CaseLogPanel />
      </div>
      <SourceHealth />
      <div className="grid-2">
        <TelemetryPanel mode="full" />
        <TopologyPanel mode="full" />
      </div>
    </>
  );
}

/**
 * What the console is actually receiving, per source.
 *
 * Command is where an analyst decides whether to trust what they are looking
 * at, and that decision needs the sources listed *including the empty ones* —
 * someone who cannot tell "no events" from "not collecting" has no way to know
 * whether silence is good news.
 *
 * The word for an empty source here is "Quiet", never "Down". Nothing in Case
 * 001 reports a collector outage, and dressing an empty feed up as a failed one
 * would be a status nobody could verify.
 */
function SourceHealth() {
  const ctx = useGame();
  const rows = sourceHealth(ctx);
  const open = unresolvedCriticalFindings(ctx).length;

  return (
    <Panel
      id="command-source-health"
      title={t('command.sources')}
      actions={
        <Badge tone={open === 0 ? 'success' : 'warning'} icon={open === 0 ? 'check' : 'alert'}>
          {open === 0
            ? t('command.containment.closed', { total: FINDINGS.length })
            : t('command.containment.open', { count: open, total: FINDINGS.length })}
        </Badge>
      }
    >
      <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
        {t('command.sources.intro')}
      </p>
      <div className="table-scroll">
        <table className="table" id="source-health-table">
          <thead>
            <tr>
              <th scope="col">{t('command.sources.col.source')}</th>
              <th scope="col">{t('command.sources.col.systems')}</th>
              <th scope="col">{t('command.sources.col.events')}</th>
              <th scope="col">{t('command.sources.col.last')}</th>
            </tr>
          </thead>
          <tbody>
            {/*
             * `source-health-` rather than `source-`: the investigation tools
             * already own `source-<artifactId>` for a record's collection
             * state, and two elements sharing an id is a defect even when the
             * two surfaces do not currently mount together.
             */}
            {rows.map((row) => (
              <tr key={row.sourceType} id={`source-health-${row.sourceType}`}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    {t(`investigate.type.${row.sourceType}`)}
                    <Badge tone={row.state === 'feeding' ? 'success' : 'neutral'}>
                      {t(`command.sources.${row.state}`)}
                    </Badge>
                  </div>
                </th>
                <td className="mono" style={{ fontSize: 'var(--type-xs-size)' }}>
                  {row.systems.length === 0 ? '—' : row.systems.join(', ')}
                </td>
                <td className="mono">{row.events}</td>
                <td className="mono">
                  {row.lastEventAt === null ? (
                    <span className="muted">{t('command.sources.none')}</span>
                  ) : (
                    `${row.lastEventAt} · ${formatAge(row.ageSec ?? 0)}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * The case queue.
 *
 * One row, because this scenario has one case, and saying so is better than
 * padding the table with cases that do not exist. There is no SLA column for
 * the same reason: Case 001 defines no target, and an invented one would be the
 * first number on the page a senior analyst could catch out.
 */
function CaseQueue() {
  const ctx = useGame();
  const runtime = useRuntime();
  const status = incidentStatus(ctx);

  return (
    <Panel
      id="case-queue"
      title={t('command.queue')}
      actions={
        <span className="muted text-xs">
          {t('command.single_case')}
        </span>
      }
    >
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('command.queue.col.case')}</th>
              <th scope="col">{t('command.queue.col.title')}</th>
              <th scope="col">{t('command.queue.col.severity')}</th>
              <th scope="col">{t('command.queue.col.status')}</th>
              <th scope="col">{t('command.queue.col.owner')}</th>
              <th scope="col">{t('command.queue.col.elapsed')}</th>
            </tr>
          </thead>
          <tbody>
            <tr id={`queue-${CASE_ID}`} aria-current="true">
              <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                <div>{CASE_ID}</div>
                <div className="muted text-xs">
                  {INCIDENT_ID}
                </div>
              </th>
              <td>{t('incident.title')}</td>
              <td>
                <Badge tone="critical" icon="alert">
                  {t('overview.severity.critical')}
                </Badge>
              </td>
              <td>
                <Badge tone={status === 'active' ? 'critical' : 'success'}>
                  {status === 'active'
                    ? t('overview.status.active')
                    : status === 'contained'
                      ? t('overview.status.contained')
                      : t('overview.status.closed')}
                </Badge>
              </td>
              <td>{t('command.owner.value', { name: ctx.operatorName })}</td>
              <td className="mono">{formatElapsed(elapsedSeconds(ctx))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="row">
        <p className="muted text-xs grow">
          {t('command.no_sla')}
        </p>
        <Button
          size="sm"
          id="queue-open-investigate"
          onClick={() =>
            runtime.send({ type: 'SET_ROUTE', route: 'investigate', tab: 'siem' })
          }
        >
          <Icon name="search" size={13} />
          {t('nav.investigate')}
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Investigate
 * ------------------------------------------------------------------ */

export function InvestigateRoute() {
  return <InvestigatePanel mode="full" />;
}

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

/**
 * Evidence: a list, and the record that is actually on screen.
 *
 * The important change here is what it means to *open* something. Opening a
 * record used to be an `inspect_artifact` command, so a control anywhere in the
 * console could mark evidence read without the reader ever reaching this route
 * — the guided card did exactly that, and a player could unlock decision D2
 * from the Command destination without having laid eyes on the phishing
 * message. The decision the case is teaching was being answered blind.
 *
 * So opening is navigation, and the *inspector* is what records the read: when
 * this panel has the record mounted and available, it issues the command, once.
 * Anything else in the console that offers to open a record therefore cannot
 * advance the case on its own — it can only bring the player here.
 */
export function EvidenceRoute() {
  const ctx = useGame();
  const runtime = useRuntime();
  const run = useCommand();

  const items = artifactsWithState(ctx);
  const counts = inspectedCount(ctx);
  const selectedId = ctx.selectedArtifact;
  const selected = selectedId ? ARTIFACT_BY_ID.get(selectedId) : null;
  const selectedInspected = selectedId ? ctx.inspectedArtifacts.includes(selectedId) : false;
  const selectedAvailability = selectedId ? artifactAvailability(ctx, selectedId) : null;
  const stateVersion = ctx.stateVersion;
  const view = ctx.evidenceView;
  const setView = (next: EvidenceView) =>
    runtime.send({ type: 'SET_EVIDENCE_VIEW', view: next });

  /*
   * Recording the read.
   *
   * An effect rather than a click handler, because the claim being made is
   * "this record was on screen", and only the component that renders it can
   * make that claim honestly.
   *
   * The guard is the record *and the state version it was tried in*, not the
   * record alone. A refusal must not retry on every render — but it must also
   * not become permanent: a record refused because its diagnostic had not run
   * is readable the moment it has, and the state version is exactly the value
   * that moves when that happens.
   */
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || selectedInspected) return;
    if (selectedAvailability !== 'available') return;
    const attempt = `${selectedId}@${stateVersion}`;
    if (attempted.current === attempt) return;
    attempted.current = attempt;
    run((r) => r.inspectArtifact(selectedId));
  }, [selectedId, selectedInspected, selectedAvailability, stateVersion, run]);

  /*
   * Focus follows the record, not the route.
   *
   * A CTA elsewhere in the console sends the player here to read one specific
   * thing; landing their keyboard on the list they did not ask for would make
   * them hunt for it. Moving focus only when the *selection* changes is what
   * keeps that from fighting the scroll position a returning reader left behind.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    headingRef.current?.scrollIntoView({ block: 'nearest' });
    headingRef.current?.focus();
  }, [selectedId]);

  return (
    <div className="evidence">
      <Panel
        id="evidence-list"
        title={t('evidence.list')}
        flush
        actions={
          <span className="muted text-xs">
            {t('evidence.count', counts)}
          </span>
        }
      >
        <ul>
          {items.map(({ artifact, availability, inspected }) => {
            const locked = availability === 'locked';
            const destroyed = availability === 'destroyed';
            const revealDiagnostic = artifact.revealedBy
              ? tk(DIAGNOSTIC_BY_ID.get(artifact.revealedBy)?.titleKey ?? artifact.revealedBy)
              : '';

            return (
              <li key={artifact.id}>
                <button
                  type="button"
                  id={`evidence-${artifact.id}`}
                  className="evidence__item"
                  aria-current={selectedId === artifact.id ? 'true' : undefined}
                  disabled={locked || destroyed}
                  onClick={() => openEvidenceRecord(runtime, artifact.id)}
                >
                  <span className="evidence__item-title">{tk(artifact.titleKey)}</span>
                  <span className="evidence__item-meta">
                    <span className="mono">{artifact.timestamp}</span>
                    {artifact.untrusted ? (
                      <Badge tone="warning" icon="alert">
                        {t('evidence.untrusted_badge')}
                      </Badge>
                    ) : null}
                    {inspected ? (
                      <Badge tone="success" icon="check">
                        {t('evidence.inspected')}
                      </Badge>
                    ) : null}
                    {locked ? <Badge icon="lock">{t('evidence.locked')}</Badge> : null}
                    {destroyed ? (
                      <Badge tone="critical" icon="trash">
                        {t('evidence.destroyed')}
                      </Badge>
                    ) : null}
                  </span>
                  {locked ? (
                    <span className="evidence__item-note">
                      {t('evidence.locked_hint', { diagnostic: revealDiagnostic })}
                    </span>
                  ) : null}
                  {destroyed ? (
                    <span className="evidence__item-note">{t('evidence.destroyed_hint')}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        id="evidence-inspector"
        title={t('evidence.title')}
        actions={
          selected ? (
            <Tabs
              label={t('evidence.title')}
              value={view}
              onChange={setView}
              options={[
                { id: 'raw', label: t('evidence.raw') },
                { id: 'explained', label: t('evidence.explained') },
              ]}
            />
          ) : null
        }
      >
        {!selected ? (
          <p className="muted">{t('evidence.empty')}</p>
        ) : (
          <>
            {/*
             * The record's own name, and the focus target a CTA lands on. The
             * panel heading says "Evidence"; a reader sent here to read one
             * specific thing needs to be told which thing they are looking at.
             */}
            <h3 className="text-md" id="evidence-record-title" ref={headingRef} tabIndex={-1}>
              {tk(selected.titleKey)}
            </h3>

            <div className="row">
              <Badge icon="clock">{selected.timestamp}</Badge>
              <span className="muted text-sm">
                {t('evidence.source')}: <span className="mono">{selected.source}</span>
              </span>
              <Badge
                tone={selectedInspected ? 'success' : 'neutral'}
                icon={selectedInspected ? 'check' : 'eye'}
              >
                {selectedInspected ? t('evidence.inspected') : t('evidence.reading')}
              </Badge>
            </div>

            <MaybeUntrusted untrusted={selected.untrusted}>
              {view === 'raw' ? (
                <KeyValue
                  rows={selected.fields.map((field) => ({
                    key: tk(field.labelKey),
                    value: field.value,
                    tone: field.tone,
                    decisive: field.decisive,
                  }))}
                />
              ) : (
                <p className="prose">{tk(selected.explanationKey)}</p>
              )}
            </MaybeUntrusted>

            {/* The receipt for the read, beside the record it is about. */}
            <Receipt anchor={`evidence-${selected.id}`} />

            <ChainOfCustody artifactId={selected.id} />
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * Where this record came from, and everything the case has done to it.
 *
 * The distinction it makes that nothing else in the product does: *recorded* is
 * the source system's timestamp, *collected* is the analyst's. Confusing the
 * two is how an investigation ends up claiming it knew something before it did,
 * and the gap between them is exactly what a reviewer asks about.
 *
 * Reconstructed from the tool log, which has always carried the origin and the
 * order of every call — so this is a reading of what happened rather than a
 * second ledger that could disagree with it.
 */
function ChainOfCustody({ artifactId }: { artifactId: ArtifactId }) {
  const ctx = useGame();
  const custody = custodyRecord(ctx, artifactId);
  const collected = custody.steps.find((step) => step.kind === 'collected');

  return (
    <section className="stack stack--tight" aria-labelledby={`custody-${artifactId}`}>
      <h3 className="eyebrow" id={`custody-${artifactId}`}>
        {t('evidence.custody')}
      </h3>
      <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
        {t('evidence.custody.intro')}
      </p>

      <div className="table-scroll">
        <table className="table" id={`custody-table-${artifactId}`}>
          <thead>
            <tr>
              <th scope="col">{t('evidence.custody.col.at')}</th>
              <th scope="col">{t('evidence.custody.col.step')}</th>
              <th scope="col">{t('evidence.custody.col.by')}</th>
            </tr>
          </thead>
          <tbody>
            {custody.steps.map((step) => (
              <tr key={`${step.kind}-${step.at}`} id={`custody-${artifactId}-${step.kind}`}>
                <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                  {step.at}
                </th>
                <td>
                  <div>{t(`evidence.custody.${step.kind}`)}</div>
                  {step.kind === 'emitted' ? (
                    <div className="mono muted" style={{ fontSize: 'var(--type-xs-size)' }}>
                      {t('evidence.custody.source', { source: custody.source })}
                    </div>
                  ) : null}
                </td>
                <td>
                  <Badge tone={step.kind === 'destroyed' ? 'critical' : 'neutral'}>
                    {t('evidence.custody.by', { by: t(`evidence.custody.by.${step.by}`) })}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {collected ? (
        <p className="prose" style={{ fontSize: 'var(--type-sm-size)' }}>
          {t('evidence.custody.gap', {
            emitted: custody.emittedAt,
            collected: collected.at,
          })}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
          {t('evidence.custody.uncollected')}
        </p>
      )}
    </section>
  );
}

/**
 * The untrusted shell, applied only where the content warrants it.
 *
 * Shared with the Email tool through `UntrustedShell`, so attacker-authored
 * text carries the same warning wherever it is read.
 */
function MaybeUntrusted({
  untrusted,
  children,
}: {
  untrusted: boolean;
  children: React.ReactNode;
}) {
  return untrusted ? <UntrustedShell>{children}</UntrustedShell> : <>{children}</>;
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

/**
 * One chronology, with every row attributed.
 *
 * The incident chain and the case log used to be two lists on two surfaces, and
 * read apart neither answers the question a debrief actually asks: *what did we
 * know, and when did we act on it?* `chronology()` merges them on one clock and
 * every row carries who caused it — the estate, the operator, or the agent.
 *
 * The attribution filter is four options, which is the whole space: everything,
 * and the three actors that exist. It narrows rather than hides — the count on
 * each control says what it would show before you press it.
 */
export function TimelineRoute() {
  const ctx = useGame();
  const runtime = useRuntime();
  // The filter lives in case context so that pivoting to a record and coming
  // back does not silently reset the chronology to "everything" — see §8 of the
  // flow work. It is a view selection, so it changes no case state.
  const origin = ctx.timelineOrigin as ChronologyOrigin;
  const setOrigin = (next: TimelineOriginFilter) =>
    runtime.send({ type: 'SET_TIMELINE_ORIGIN', origin: next });

  const all = chronology(ctx);
  const counts = chronologyCounts(all);
  const rows = filterChronology(all, origin);
  const hidden = hiddenTimelineCount(ctx);

  return (
    <Panel
      id="timeline-panel"
      title={t('timeline.chronology')}
      actions={
        <div className="row" style={{ gap: 'var(--space-2)' }} role="group" aria-labelledby="timeline-origin-label">
          <span className="eyebrow" id="timeline-origin-label">
            {t('timeline.attribution')}
          </span>
          {CHRONOLOGY_ORIGINS.map((id) => (
            <Button
              key={id}
              size="sm"
              id={`timeline-origin-${id}`}
              variant={origin === id ? 'primary' : 'ghost'}
              aria-pressed={origin === id}
              onClick={() => setOrigin(id as TimelineOriginFilter)}
            >
              {t('timeline.origin.count', {
                label: t(`timeline.origin.${id}`),
                count: counts[id],
              })}
            </Button>
          ))}
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
        {t('timeline.chronology.intro')}
      </p>

      {rows.length === 0 ? (
        <p className="muted">{t('timeline.empty_filter')}</p>
      ) : (
        <ol className="timeline">
          {rows.map((entry) => (
            <li key={entry.id} className="timeline__row">
              <span className="timeline__time">{entry.at}</span>
              <span className="timeline__marker">
                <span
                  className={
                    entry.severity === 'critical'
                      ? 'dot dot--critical'
                      : entry.severity === 'warn'
                        ? 'dot dot--warning'
                        : entry.severity === 'good'
                          ? 'dot dot--success'
                          : 'dot dot--accent'
                  }
                />
              </span>
              <span className="stack stack--tight">
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <span className="timeline__label">{entry.text}</span>
                  {/* Text, not a colour: who did this is the column the two
                      halves of the chronology could not previously share. */}
                  <Badge tone={entry.origin === 'system' ? 'neutral' : 'accent'}>
                    {t(`timeline.by.${entry.origin}`)}
                  </Badge>
                </span>
                {entry.artifactId ? (
                  <span>
                    {/*
                      * One behaviour, shared with the guided card and the rail:
                      * open the record. It used to branch on whether the record
                      * had already been read — inspecting in place when it had
                      * not, which marked evidence read from a destination that
                      * cannot show it.
                      */}
                    <Button
                      size="sm"
                      variant="ghost"
                      id={`timeline-open-${entry.artifactId}`}
                      onClick={() => openEvidenceRecord(runtime, entry.artifactId!)}
                    >
                      <Icon name="eye" size={13} />
                      {t('timeline.open_artifact')}
                    </Button>
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}

      {hidden > 0 ? (
        <p className="muted text-sm">
          <Icon name="lock" size={13} /> {hidden} × {t('timeline.locked')}
        </p>
      ) : null}
    </Panel>
  );
}

export function TimelineRouteWithLog() {
  return (
    <>
      <TimelineRoute />
      <CaseLogPanel limit={60} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Respond — operations, prerequisites, blast radius and verification
 * ------------------------------------------------------------------ */

export function RespondRoute() {
  const ctx = useGame();
  const run = useCommand();
  const [pending, setPending] = useState<ResponseActionId | null>(null);

  const recommended = new Set(recommendedActions(ctx));
  const pendingAction = pending ? RESPONSE_ACTIONS.find((a) => a.id === pending) : null;

  return (
    <>
      <BlastRadius />

      <Panel id="playbook-diagnostics" title={t('playbook.diagnostics')}>
        {DIAGNOSTICS.map((diagnostic) => {
          const ran = ctx.ranDiagnostics.includes(diagnostic.id);
          return (
            <div
              key={diagnostic.id}
              id={`diagnostic-${diagnostic.id}`}
              className="stack stack--tight"
              style={{
                borderBottom: '1px solid var(--border)',
                paddingBottom: 'var(--space-4)',
              }}
            >
              <div className="row">
                <strong className="text-md">{tk(diagnostic.titleKey)}</strong>
                {ran ? (
                  <Badge tone="success" icon="check">
                    {t('playbook.ran')}
                  </Badge>
                ) : null}
                <span style={{ marginLeft: 'auto' }}>
                  <Button
                    size="sm"
                    variant={ran ? 'ghost' : 'primary'}
                    disabled={ran}
                    reason={ran ? t('error.diagnostic_done') : undefined}
                    onClick={() => run((r) => r.runDiagnostic(diagnostic.id))}
                  >
                    <Icon name="search" size={14} />
                    {t('playbook.run')}
                  </Button>
                </span>
              </div>
              <p className="prose muted text-sm">
                {tk(diagnostic.descriptionKey)}
              </p>

              {ran ? (
                <div className="stack stack--tight">
                  <p className="prose text-sm">
                    {tk(diagnostic.resultKey)}
                  </p>
                  <div className="table-scroll">
                    <table className="table">
                      <tbody>
                        {diagnosticRows(ctx, diagnostic.id).map((row, index) => (
                          // `row.key` is a display value and repeats — the auth
                          // timeline has two rows at 03:02:14 (P0.8). Keys must
                          // never be display values.
                          <tr key={`${diagnostic.id}-${index}`}>
                            <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                              {row.key}
                            </th>
                            <td className={row.tone ? `kv__value kv__value--${row.tone}` : 'kv__value'}>
                              {row.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* The receipt for this diagnostic, beside the control that ran
                  it — not 900px down the page in a shared summary block. */}
              <Receipt anchor={`diagnostic-${diagnostic.id}`} />
            </div>
          );
        })}
      </Panel>

      <Panel id="playbook-actions" title={t('playbook.actions')}>
        {RESPONSE_ACTIONS.map((action) => {
          const availability = actionAvailability(ctx, action.id);
          const done = hasPerformed(ctx, action.id);
          const isRecommended = recommended.has(action.id);

          return (
            <div
              key={action.id}
              id={`action-${action.id}`}
              className="stack stack--tight"
              style={{
                borderBottom: '1px solid var(--border)',
                paddingBottom: 'var(--space-4)',
              }}
            >
              <div className="row">
                <strong className="text-md">{tk(action.labelKey)}</strong>
                {action.destructive ? <Badge tone="critical">{t('action.destructive_badge')}</Badge> : null}
                {isRecommended ? (
                  <Badge tone="accent" icon="check">
                    {t('playbook.recommended')}
                  </Badge>
                ) : null}
                {done ? (
                  <Badge tone="success" icon="check">
                    {t('action.done')}
                  </Badge>
                ) : null}
              </div>

              <p className="prose muted text-sm">
                {tk(action.impactKey)}
              </p>

              <Prerequisites actionId={action.id} />

              {done ? (
                <>
                  <p className="prose text-sm tone-good">
                    {tk(action.resultKey)}
                  </p>
                  <VerificationStatus actionId={action.id} />
                </>
              ) : availability.allowed ? (
                <ConsequencePreview actionId={action.id} />
              ) : null}

              <Receipt anchor={`action-${action.id}`} />

              {done ? null : (
                <div>
                  <Button
                    variant={action.destructive ? 'danger' : 'primary'}
                    disabled={!availability.allowed}
                    reason={
                      availability.allowed
                        ? undefined
                        : availability.reasonKey
                          ? t(availability.reasonKey)
                          : t('action.locked')
                    }
                    onClick={() => {
                      if (action.requiresConfirmation) setPending(action.id);
                      else run((r) => r.takeResponseAction(action.id));
                    }}
                  >
                    {tk(action.labelKey)}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Panel>

      <ContainmentChecklist />

      {pendingAction ? (
        <ConfirmDialog
          titleKey="action.confirm_title"
          titleValues={{ label: tk(pendingAction.labelKey) }}
          impact={tk(pendingAction.impactKey)}
          confirmLabel={t('action.confirm')}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const id = pendingAction.id;
            setPending(null);
            run((r) => r.takeResponseAction(id));
          }}
        />
      ) : null}
    </>
  );
}

/**
 * What this operation will change, before it is authorised.
 *
 * Derived by running the operation against a copy of the case and comparing the
 * simulated sources — the same diff the engine reports afterwards, from the same
 * snapshot function. That is the point: a hand-written preview would be free to
 * promise that resetting the password kills the stolen session, and nothing
 * would catch it until the operator had already clicked. Here the promise and
 * the receipt are computed the same way, so `reset_credentials` shows the
 * password rotating and pointedly does *not* show `d.arslan.issued-tokens`
 * moving — which is decision D3's whole lesson, told before the mistake instead
 * of after it.
 */
function ConsequencePreview({ actionId }: { actionId: ResponseActionId }) {
  const ctx = useGame();
  const effects = previewEffects(ctx, actionId);

  return (
    <div className="stack stack--tight" id={`preview-${actionId}`}>
      <div className="row">
        <span className="eyebrow">{t('respond.preview')}</span>
        <span className="mono muted" style={{ fontSize: 'var(--type-xs-size)' }}>
          {t(effects.length === 1 ? 'respond.preview.count_one' : 'respond.preview.count', {
            count: effects.length,
          })}
        </span>
      </div>

      {effects.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
          {t('respond.preview.none')}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('respond.preview.col.fact')}</th>
                <th scope="col">{t('respond.preview.col.before')}</th>
                <th scope="col">{t('respond.preview.col.after')}</th>
              </tr>
            </thead>
            <tbody>
              {effects.map((effect) => (
                <tr key={`${effect.source}/${effect.key}`}>
                  <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                    <div>{effect.key}</div>
                    <div className="muted" style={{ fontSize: 'var(--type-xs-size)' }}>
                      {t(`respond.source.${effect.source}`)}
                    </div>
                  </th>
                  <td className="mono muted">{effect.before}</td>
                  <td className="mono kv__value kv__value--good">{effect.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: 'var(--type-xs-size)' }}>
        {t('respond.preview.honest')}
      </p>
    </div>
  );
}

/**
 * Whether the operation's effects are still standing.
 *
 * Read against the live sources rather than against a stored receipt, so
 * "applied" and "verified" are genuinely different claims. Containment that is
 * only asserted is not containment.
 */
function VerificationStatus({ actionId }: { actionId: ResponseActionId }) {
  const ctx = useGame();
  const verification = verifyAction(ctx, actionId);

  return (
    <div className="stack stack--tight" id={`verification-${actionId}`}>
      <div className="row">
        <span className="eyebrow">{t('respond.verification')}</span>
        <Badge
          tone={verification.state === 'verified' ? 'success' : 'warning'}
          icon={verification.state === 'verified' ? 'check' : 'alert'}
        >
          {verification.state === 'verified'
            ? t('respond.verification.verified')
            : t('respond.verification.partial', { count: verification.outstanding.length })}
        </Badge>
      </div>
      <ul className="stack stack--tight">
        {verification.confirmed.map((fact) => (
          <li key={`${fact.source}/${fact.key}`} className="mono" style={{ fontSize: 'var(--type-xs-size)' }}>
            {fact.key} — {fact.state}
          </li>
        ))}
        {verification.outstanding.map((line) => (
          <li key={line} className="mono kv__value kv__value--bad" style={{ fontSize: 'var(--type-xs-size)' }}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How wide the incident is known to be, right now.
 *
 * Counted from the same `visibleIdentities` / `visibleAssets` selectors the
 * investigation tools use, so it grows when the sweep finds the second laptop
 * rather than being a number somebody typed. Until the sweep runs it says out
 * loud that it is a lower bound — a blast radius that looks confident before
 * anyone measured it is the mistake D5 exists to teach.
 */
function BlastRadius() {
  const ctx = useGame();
  const scoped = ctx.ranDiagnostics.includes('indicator_scope');

  return (
    <Panel id="respond-blast-radius" title={t('respond.blast_radius')}>
      <p className="row" id="blast-radius-value">
        <Badge tone={scoped ? 'accent' : 'warning'} icon={scoped ? 'check' : 'alert'}>
          {t('respond.blast_radius.value', {
            identities: visibleIdentities(ctx).length,
            assets: visibleAssets(ctx).length,
          })}
        </Badge>
      </p>
      {scoped ? null : (
        <p className="muted text-sm">
          {t('respond.blast_radius.unscoped')}
        </p>
      )}
    </Panel>
  );
}

/**
 * What the case says you should have done before this operation.
 *
 * Read straight off the action's own `conditionalPenalties`, which is where the
 * engine keeps the same rule it scores against — so the warning shown before
 * the click and the penalty applied after it can never disagree.
 */
function Prerequisites({ actionId }: { actionId: ResponseActionId }) {
  const ctx = useGame();
  const action = RESPONSE_ACTIONS.find((candidate) => candidate.id === actionId);
  const penalties = action?.conditionalPenalties ?? [];
  if (penalties.length === 0) return null;

  return (
    <ul className="stack stack--tight" id={`prerequisites-${actionId}`}>
      {penalties.map((penalty) => {
        const diagnosticId = penalty.whenMissing.diagnostic;
        const artifactId = penalty.whenMissing.artifact;
        const met = diagnosticId
          ? ctx.ranDiagnostics.includes(diagnosticId)
          : artifactId
            ? ctx.inspectedArtifacts.includes(artifactId)
            : true;

        const label = diagnosticId
          ? tk(DIAGNOSTIC_BY_ID.get(diagnosticId)?.titleKey ?? diagnosticId)
          : artifactId
            ? tk(ARTIFACT_BY_ID.get(artifactId)?.titleKey ?? artifactId)
            : '';

        return (
          <li key={`${diagnosticId ?? ''}${artifactId ?? ''}`} className="row">
            <Badge tone={met ? 'success' : 'warning'} icon={met ? 'check' : 'alert'}>
              {t('respond.prerequisite')}
            </Badge>
            <span className="muted text-sm">
              {met
                ? t('respond.prerequisite.met')
                : diagnosticId
                  ? t('respond.prerequisite.diagnostic', { label })
                  : t('respond.prerequisite.artifact', { label })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Debrief — deliberately not a route in this file
 * ------------------------------------------------------------------ */

/*
 * There is no locked-debrief route here, and the absence is load-bearing.
 *
 * One used to live at the foot of this file: a `DebriefLockedRoute` panel that
 * named the sixth destination and listed what still had to happen before it
 * opened. Nothing in the product could render it. `SideNav` disables the
 * Debrief row while the case is open, and when it is enabled it sends
 * `OPEN_DEBRIEF` rather than `SET_ROUTE`; no other caller anywhere sets the
 * route to `debrief`; and the dashboard state's
 * `always: { target: 'debrief', guard: 'caseClosed' }` takes the player out of
 * this scene the instant the case closes. `ctx.route === 'debrief'` was
 * therefore a branch with no path into it — a panel that read as coverage of
 * the locked state and had never once been on screen.
 *
 * The locked state does have a UI. It is the nav row itself: disabled, with
 * `nav.debrief.locked` carried in its accessible name, which is the honest
 * place for it because that is the control the player actually pushes against.
 * `tests/unit/debriefRoute.test.ts` holds both halves — the row says why it is
 * locked, and `OPEN_DEBRIEF` on an open case moves nothing.
 */
