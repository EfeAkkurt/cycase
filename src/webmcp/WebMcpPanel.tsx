import { createContext, useContext, useState, type ReactNode } from 'react';

import { t } from '../i18n';
import { Badge, Button, Icon, Panel } from '../ui/primitives';
import { agentPrompt } from './agentPrompts';
import { TOOL_DEFINITIONS } from './tools';
import type { WebMcpStatus } from './useWebMcpTools';

const TOTAL_TOOLS = TOOL_DEFINITIONS.length;

const WebMcpContext = createContext<WebMcpStatus>({
  supported: false,
  registered: false,
  toolNames: [],
  error: null,
});

export function WebMcpProvider({
  status,
  children,
}: {
  status: WebMcpStatus;
  children: ReactNode;
}) {
  return <WebMcpContext.Provider value={status}>{children}</WebMcpContext.Provider>;
}

export function useWebMcpStatus(): WebMcpStatus {
  return useContext(WebMcpContext);
}

/** Compact agent connection for the sidebar. Details live in the rail. */
export function WebMcpBadge() {
  const status = useWebMcpStatus();
  const short = status.registered
    ? t('topbar.agent.connected')
    : t('topbar.agent.offline');
  const detail = status.registered
    ? t('webmcp.status.registered', { count: status.toolNames.length })
    : status.supported
      ? t('webmcp.status.partial', { count: status.toolNames.length, total: TOTAL_TOOLS })
      : t('webmcp.status.unsupported');

  return (
    <div className="stat" id="webmcp-status">
      <span className="stat__label">{t('webmcp.title')}</span>
      <span className="stat__value">
        <Badge tone={status.registered ? 'success' : 'neutral'} icon="agent">
          {short}
        </Badge>
        <span className="sr-only">{detail}</span>
      </span>
    </div>
  );
}

/**
 * Full agent panel for the rail.
 *
 * When WebMCP is missing this says plainly that the case is still fully
 * playable — feature detection is a product decision here, not just a guard.
 */
export function WebMcpPanel() {
  const status = useWebMcpStatus();
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt('learn', 'en'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel
      id="rail-webmcp"
      title={t('webmcp.title')}
      actions={
        status.registered ? (
          <Badge tone="accent" icon="agent">
            {status.toolNames.length}
          </Badge>
        ) : null
      }
    >
      {status.toolNames.length > 0 ? (
        <>
          <span className="eyebrow">{t('webmcp.tools')}</span>
          <ul className="stack stack--tight">
            {status.toolNames.map((name) => (
              <li key={name} className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
                <span className="dot dot--accent" />
                <code className="mono text-xs">
                  {name}
                </code>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="stack stack--tight">
          <span className="row" style={{ gap: 'var(--space-2)' }}>
            <Icon name="alert" size={14} />
            <strong className="text-sm">
              {status.supported
                ? t('webmcp.status.partial', { count: 0, total: TOTAL_TOOLS })
                : t('webmcp.status.unsupported')}
            </strong>
          </span>
          <p className="prose muted text-sm">
            {status.supported
              ? t('webmcp.status.partial_detail')
              : t('webmcp.status.unsupported_detail')}
          </p>
        </div>
      )}

      {status.error ? (
        <code
          className="mono text-xs tone-bad wrap-anywhere"
        >
          {status.error}
        </code>
      ) : null}

      <Button size="sm" variant="ghost" block onClick={copyPrompt}>
        <Icon name="link" size={13} />
        {copied ? t('webmcp.copied') : t('webmcp.copy_prompt')}
      </Button>
    </Panel>
  );
}
