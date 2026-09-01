import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { t } from '../../i18n';
import type { StringKey } from '../../i18n';

/* ------------------------------------------------------------------ *
 * Icons — inline SVG so nothing depends on an icon font or a network call.
 * Every icon is decorative unless given a `label`, in which case it carries
 * the accessible name (DESIGN_SYSTEM.md: never rely on colour alone).
 * ------------------------------------------------------------------ */

export type IconName =
  | 'alert'
  | 'check'
  | 'lock'
  | 'shield'
  | 'mail'
  | 'key'
  | 'device'
  | 'search'
  | 'agent'
  | 'node'
  | 'clock'
  | 'link'
  | 'trash'
  | 'eye'
  | 'block'
  | 'panelLeft'
  | 'panelRight'
  | 'settings';

const PATHS: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.2" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: <path d="M12 3 4 6v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V6l-8-3Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M15.5 12v2" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 13h.01M15 13h.01" />
    </>
  ),
  node: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M9.5 11.5h.01M14.5 11.5h.01M9.5 15c1.6 1.2 3.4 1.2 5 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m6.5 6.5 11 11" />
    </>
  ),
  /*
   * The sidebar toggle. A panel outline with the rail edge filled in and a
   * chevron pointing the way the column is about to move, so the control shows
   * its *result* rather than its current state — the ambiguity that makes a
   * bare hamburger unreadable in a collapsible shell.
   */
  panelLeft: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14" />
      <path d="m16.5 9.5-2.5 2.5 2.5 2.5" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14" />
      <path d="m13.5 9.5 2.5 2.5-2.5 2.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export type PanelVariant = 'summary' | 'workbench' | 'data-table' | 'critical' | 'disclosure';

export function Panel({
  title,
  id,
  tone,
  compact,
  variant = 'workbench',
  actions,
  flush,
  children,
  headingLevel = 2,
}: {
  title: string;
  id?: string;
  tone?: 'critical';
  compact?: boolean;
  variant?: PanelVariant;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const resolved = tone === 'critical' ? 'critical' : compact ? 'summary' : variant;

  return (
    <section
      id={id}
      className={[
        'panel',
        `panel--${resolved}`,
        compact ? 'panel--compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={headingId}
    >
      <header className="panel__head">
        <Heading className="panel__title" id={headingId}>
          {title}
        </Heading>
        {actions}
      </header>
      <div className={flush || resolved === 'data-table' ? 'panel__body panel__body--flush' : 'panel__body'}>
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success';
  size?: 'md' | 'sm';
  block?: boolean;
  /** Rendered under the label. A disabled control must always say why. */
  reason?: string;
  /** Replaces the label with a spinner and sets aria-busy. */
  busy?: boolean;
  /** React 19 passes `ref` as a plain prop; forwarded to the underlying button. */
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'default',
  size = 'md',
  block,
  reason,
  busy,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const resolved = busy && variant === 'primary' ? 'primary' : variant;
  return (
    <button
      type="button"
      className={[
        'btn',
        `btn--${resolved === 'default' ? 'secondary' : resolved}`,
        size === 'sm' ? 'btn--sm' : '',
        block ? 'btn--block' : '',
        busy ? 'btn--loading' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="btn__spinner" aria-hidden="true" /> : null}
      <span className="btn__label">
        {children}
        {reason ? <span className="btn__reason">{reason}</span> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Badge and status dot
 * ------------------------------------------------------------------ */

export type Tone = 'critical' | 'warning' | 'success' | 'accent' | 'neutral';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span
      className={[
        'dot',
        tone === 'neutral' ? '' : `dot--${tone}`,
        pulse ? 'pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Key/value list
 * ------------------------------------------------------------------ */

export function KeyValue({
  rows,
}: {
  rows: { key: string; value: string; tone?: 'bad' | 'warn' | 'good'; decisive?: boolean }[];
}) {
  return (
    <dl className="kv">
      {rows.map((row, index) => (
        <div
          key={`${row.key}-${index}`}
          className={row.decisive ? 'kv__row kv__row--decisive' : 'kv__row'}
        >
          <dt className="kv__key">
            {row.key}
            {row.decisive ? <span className="sr-only"> — {t('evidence.decisive')}</span> : null}
          </dt>
          <dd className={row.tone ? `kv__value kv__value--${row.tone}` : 'kv__value'}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

/**
 * A tablist with the keyboard behaviour the pattern requires.
 *
 * Roving tabindex means the whole strip is one Tab stop, and Left/Right (plus
 * Home/End) move between tools inside it — which is the difference between a
 * keyboard user reaching the fifth investigation tool in one keystroke and
 * tabbing past four of them to get there. Selection follows focus, so arrowing
 * onto a tool opens it.
 *
 * There is deliberately no `aria-controls`: several tabs cannot honestly claim
 * to control one swapped panel, and a dangling reference is a worse failure
 * than an absent optional attribute. Callers give the panel `role="tabpanel"`
 * and point `aria-labelledby` at `tabId(idBase, value)` instead.
 */
export function tabId(idBase: string, id: string): string {
  return `${idBase}-tab-${id}`;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
  idBase,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string; badge?: string }[];
  label: string;
  /** When given, each tab gets a stable id so a panel can be labelled by it. */
  idBase?: string;
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;

    let nextIndex: number | null = null;
    const current = options.findIndex((option) => option.id === value);

    if (delta !== 0 && current !== -1) {
      nextIndex = (current + delta + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
    }

    if (nextIndex === null) return;
    const next = options[nextIndex];
    if (!next) return;

    event.preventDefault();
    onChange(next.id);
    // Selection follows focus, so focus has to follow selection too.
    if (idBase) {
      requestAnimationFrame(() => document.getElementById(tabId(idBase, next.id))?.focus());
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          id={idBase ? tabId(idBase, option.id) : undefined}
          className="tabs__tab"
          aria-selected={option.id === value}
          tabIndex={option.id === value ? 0 : -1}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.badge ? <span className="tabs__badge">{option.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Untrusted content shell
 * ------------------------------------------------------------------ */

/**
 * The wrapper every surface that renders attacker-authored text must use.
 *
 * The phishing message and the cloned sign-in page are `untrusted: true`, and
 * they are now readable from two places — the evidence inspector and the Email
 * tool. One shell, used by both: a second surface that rendered the same text
 * without the warning would be a hole in exactly the control this notice is.
 */
export function UntrustedShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="untrusted">
        <Icon name="alert" size={18} label={t('a11y.untrusted_icon')} />
        <div>
          <strong className="text-sm" style={{ display: 'block' }}>
            {t('evidence.untrusted_badge')}
          </strong>
          <span className="untrusted__text">{t('evidence.untrusted_notice')}</span>
        </div>
      </div>
      {children}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Confirm dialog — used for every consequential action
 * ------------------------------------------------------------------ */

export function ConfirmDialog({
  titleKey,
  titleValues,
  impact,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  titleKey: StringKey;
  titleValues?: Record<string, string>;
  impact: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id={titleId}>
          {t(titleKey, titleValues)}
        </h2>
        <div className="stack stack--tight">
          <span className="eyebrow">{t('action.predicted_impact')}</span>
          <p className="prose">{impact}</p>
        </div>
        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
          <Button ref={confirmRef} variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
