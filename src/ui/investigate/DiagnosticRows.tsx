import { useCommand, useGame } from '../../app/gameContext';
import { DIAGNOSTIC_BY_ID } from '../../game/fixtures/case001';
import { t, tk } from '../../i18n';
import type { DiagnosticId } from '../../game/types';
import { Badge, Button, Icon } from '../primitives';

/**
 * A diagnostic's output, rendered inside the tool that owns the source.
 *
 * This is not a second copy of the Respond page's diagnostics section: the rows
 * are the same `DIAGNOSTIC_ROWS`, and the Run control issues the same
 * `run_diagnostic` command through the same runtime method. What changes is
 * where you reach for it — an analyst rebuilding a sign-in history looks in the
 * identity tool, not in a list of every query the platform can run.
 */
export function DiagnosticRows({
  diagnosticId,
  rows,
  emptyText,
}: {
  diagnosticId: DiagnosticId;
  rows: { key: string; value: string; tone?: 'bad' | 'warn' | 'good' }[];
  emptyText: string;
}) {
  const ctx = useGame();
  const run = useCommand();
  const diagnostic = DIAGNOSTIC_BY_ID.get(diagnosticId);
  const label = tk(diagnostic?.titleKey ?? diagnosticId);
  const ran = ctx.ranDiagnostics.includes(diagnosticId);

  if (!ran) {
    return (
      <div className="stack stack--tight">
        <p className="muted">{emptyText}</p>
        <div>
          <Button
            size="sm"
            id={`investigate-run-${diagnosticId}`}
            onClick={() => run((r) => r.runDiagnostic(diagnosticId))}
          >
            <Icon name="search" size={13} />
            {t('investigate.run_query', { label })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack--tight">
      <div className="row">
        <Badge tone="success" icon="check">
          {t('investigate.query_done', { label })}
        </Badge>
      </div>
      <div className="table-scroll">
        <table className="table" id={`investigate-rows-${diagnosticId}`}>
          <tbody>
            {rows.map((row, index) => (
              // `row.key` repeats — the auth timeline has two rows at 03:02:14.
              <tr key={`${diagnosticId}-${index}`}>
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
  );
}
