import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import { commandReceipt, type CommandReceipt, type GuidedCommand } from '../../game/selectors';
import type { GameRuntime } from '../../game/runtime';
import type { ToolResult } from '../../game/types';
import { t } from '../../i18n';
import { Badge, Button, Icon } from '../primitives';
import { openRoute } from './flow';
import { useClaimedReceiptSeq } from './receiptClaim';

/* ------------------------------------------------------------------ *
 * The receipt
 * ------------------------------------------------------------------ *
 *
 * Three questions, answered where the player is already looking, for every
 * decision, diagnostic and containment action: what happened, what changed, why
 * it mattered. Nothing is deferred, nothing is behind a disclosure, and nothing
 * waits for a timer — the block is rendered from case state in the same React
 * commit as the command that produced it, so "within 250ms" is a property of
 * the architecture rather than a target something has to hit.
 *
 * When a call is refused, or an operation lands only partly, it additionally
 * says what did *not* change and offers exactly one way forward. One: an error
 * that offers three recoveries has admitted it does not know which is right.
 */

export function Receipt({
  anchor,
  /** Set by the guided card, which owns receipts for the commands it issues. */
  claimed = false,
}: {
  anchor?: string;
  claimed?: boolean;
}) {
  const ctx = useGame();
  const claimedSeq = useClaimedReceiptSeq();
  const receipt = commandReceipt(ctx);

  if (!receipt) return null;

  const isClaimed = receipt.seq === claimedSeq;
  // Ownership by issue. The card that ran the command shows the receipt; every
  // other anchored slot stands down so the page never carries two.
  if (claimed !== isClaimed) return null;
  if (!claimed && receipt.anchor !== anchor) return null;

  return <ReceiptBody receipt={receipt} />;
}

const TONE = {
  done: { tone: 'success', icon: 'check', labelKey: 'receipt.state.done' },
  partial: { tone: 'warning', icon: 'alert', labelKey: 'receipt.state.partial' },
  failed: { tone: 'critical', icon: 'alert', labelKey: 'receipt.state.failed' },
} as const;

function ReceiptBody({ receipt }: { receipt: CommandReceipt }) {
  const runtime = useRuntime();
  const run = useCommand();
  const style = TONE[receipt.state];

  /*
   * Built entirely from the design system's existing `.outcome` block, which is
   * the same species of thing — a titled tray of "what happened / what changed
   * / why". Reusing it keeps the receipt on the type scale, the spacing grid
   * and the tray surface without inventing a parallel set of styles, and the
   * state is carried by a badge rather than by colour on the container.
   */
  return (
    <section
      className="outcome"
      id={`receipt-${receipt.anchor}`}
      data-testid="receipt"
      data-receipt-state={receipt.state}
      data-receipt-seq={receipt.seq}
      aria-label={t('receipt.title')}
      /*
       * `alert` for a refusal, `status` for everything else. A refused call is
       * the one case where the player is waiting on an answer that did not
       * arrive, and it is short — the successful receipts are long enough that
       * an assertive region would talk over the page on every single step.
       */
      role={receipt.state === 'failed' ? 'alert' : 'status'}
    >
      <div className="row">
        <Badge tone={style.tone} icon={style.icon}>
          {t(style.labelKey)}
        </Badge>
        <span className="outcome__title">{t('receipt.title')}</span>
      </div>

      <p className="outcome__step">{receipt.title}</p>

      <dl className="outcome__grid">
        <dt>{t('receipt.result')}</dt>
        <dd className="prose">{receipt.result}</dd>

        {receipt.changed.length > 0 ? (
          <>
            <dt>{t('receipt.changed')}</dt>
            <dd>
              <ul className="outcome__changed">
                {receipt.changed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}

        {receipt.unchanged.length > 0 ? (
          <>
            <dt>{t('receipt.unchanged')}</dt>
            <dd>
              <ul className="outcome__changed" id="receipt-unchanged">
                {receipt.unchanged.map((line) => (
                  // Not a colour: "did not change" is carried by the heading
                  // above the list, which a screen reader reaches first.
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}

        <dt>{t('receipt.why')}</dt>
        <dd className="prose">{receipt.why}</dd>
      </dl>

      {receipt.recovery ? (
        <div className="row">
          <Button
            size="sm"
            variant="primary"
            id="receipt-recovery"
            reason={receipt.recovery.hint}
            onClick={() => {
              const { command, route } = receipt.recovery!;
              if (command) run((r) => issueCommand(r, command));
              else if (route) openRoute(runtime, route);
            }}
          >
            <Icon name="shield" size={13} />
            {receipt.recovery.label}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** One command, issued through the runtime a WebMCP call would use. */
export function issueCommand(runtime: GameRuntime, command: GuidedCommand): ToolResult {
  if (command.kind === 'inspect_artifact') return runtime.inspectArtifact(command.artifactId);
  if (command.kind === 'run_diagnostic') return runtime.runDiagnostic(command.diagnosticId);
  return runtime.takeResponseAction(command.actionId);
}
