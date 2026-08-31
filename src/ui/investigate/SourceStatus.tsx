import { useCommand } from '../../app/gameContext';
import { DIAGNOSTIC_BY_ID } from '../../game/fixtures/case001';
import type { SourceRecord } from '../../game/investigate';
import { t, tk } from '../../i18n';
import { Badge, Button, Icon, KeyValue } from '../primitives';

/**
 * What a tool shows in place of a record it cannot read.
 *
 * Every investigation tool goes through this, which is what stops five separate
 * surfaces from each inventing their own idea of "you have not earned this
 * yet". The four states map exactly onto the ones the evidence inspector
 * already has, so a locked sign-in log reads the same wherever you meet it.
 *
 * Returns null when the record is readable — the tool renders its own fields.
 */
export function SourceStatus({ record }: { record: SourceRecord }) {
  const run = useCommand();

  if (record.state === 'ready') return null;

  if (record.state === 'locked') {
    const diagnostic = record.unlockedBy
      ? tk(DIAGNOSTIC_BY_ID.get(record.unlockedBy)?.titleKey ?? record.unlockedBy)
      : '';
    return (
      <p className="source-status" id={`source-${record.artifactId}`}>
        <Badge icon="lock">{t('investigate.source.locked')}</Badge>
        <span className="muted">{t('investigate.source.locked_hint', { diagnostic })}</span>
      </p>
    );
  }

  if (record.state === 'destroyed') {
    return (
      <p className="source-status" id={`source-${record.artifactId}`}>
        <Badge tone="critical" icon="trash">
          {t('investigate.source.destroyed')}
        </Badge>
        <span className="muted">{t('investigate.source.destroyed_hint')}</span>
      </p>
    );
  }

  return (
    <p className="source-status" id={`source-${record.artifactId}`}>
      <Badge icon="eye">{t('investigate.source.uncollected')}</Badge>
      <span className="muted">
        {t('investigate.source.uncollected_hint', { source: record.source })}
      </span>
      <Button
        size="sm"
        id={`collect-${record.artifactId}`}
        onClick={() => run((r) => r.inspectArtifact(record.artifactId))}
      >
        <Icon name="eye" size={13} />
        {t('investigate.source.collect', { source: record.source })}
      </Button>
    </p>
  );
}

/**
 * The fields of a collected record, optionally narrowed to the ones this tool
 * is about. Reuses the same `KeyValue` rendering as the evidence inspector, so
 * a decisive field is marked decisive in both places.
 */
export function SourceFields({
  record,
  only,
}: {
  record: SourceRecord;
  /** Label keys to show, in this order. Omit for every field. */
  only?: string[];
}) {
  const fields = only
    ? only
        .map((labelKey) => record.fields.find((field) => field.labelKey === labelKey))
        .filter((field): field is NonNullable<typeof field> => field !== undefined)
    : record.fields;

  if (fields.length === 0) return null;

  return (
    <KeyValue
      rows={fields.map((field) => ({
        key: tk(field.labelKey),
        value: field.value,
        tone: field.tone,
        decisive: field.decisive,
      }))}
    />
  );
}
