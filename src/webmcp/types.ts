/**
 * Minimal typings for the WebMCP imperative API.
 *
 * Deliberately hand-written and narrow: the specification is still moving, so
 * the app depends on the smallest possible surface and feature-detects the rest
 * at runtime. Re-check against the sources listed in docs/PROJECT_CONTEXT.md §14
 * before widening this.
 */

export interface ModelContextToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<ToolExecuteResult> | ToolExecuteResult;
}

export interface ToolExecuteResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** A descriptor as the *browser* hands it back from `getTools()`. */
export interface DiscoveredTool {
  name: string;
  description?: string;
  /** Chrome hands this back already serialised. */
  inputSchema?: Record<string, unknown> | string;
  annotations?: Record<string, unknown>;
}

export interface ModelContext {
  registerTool: (
    descriptor: ModelContextToolDescriptor,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<void> | void;
  getTools?: (options?: { fromOrigins?: string[] }) => Promise<DiscoveredTool[]>;
  /**
   * Present on the real Chrome surface (verified on 151.0.7922.171, whose
   * prototype carries registerTool/getTools/executeTool/ontoolchange). This is
   * how an agent actually invokes a tool, so the native suite drives it rather
   * than reaching into our own registration closure.
   */
  executeTool?: (
    tool: DiscoveredTool,
    /** Chrome parses this itself; it must be a JSON string, not an object. */
    inputJson: string,
    /** Chrome returns the envelope serialised as well. */
  ) => Promise<ToolExecuteResult | string>;
  ontoolchange?: ((event: Event) => void) | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export function getModelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null;
  const context = document.modelContext;
  if (!context || typeof context.registerTool !== 'function') return null;
  return context;
}
