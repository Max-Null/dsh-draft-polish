/**
 * Typed fetch wrapper over the /draft-polish JSON API (the host half's
 * polish route). Mirrors the wire envelope `{ok: true, value} | {ok: false, error}`.
 */

/** One wire failure. */
export class DraftPolishApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Result of one polish call. */
export interface PolishResult {
  ok: boolean
  text: string | null
  reason?: string
}

/** Resolved draft-polish configuration (mirror of the host DraftPolishConfig). */
export interface DraftPolishConfigView {
  provider: string
  model: string
  reasoningEffort: string
  budgetTokens: number
  temperature: number
  timeoutMs: number
  contextEnabled: boolean
  recentWindowMessages: number
  backgroundEnabled: boolean
  backgroundWindowMessages: number
  backgroundBudgetTokens: number
}

/** The config namespace envelope (value + revision for revision-guarded writes). */
export interface DraftPolishConfigEnvelope {
  value?: DraftPolishConfigView
  revision?: number
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/draft-polish/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new DraftPolishApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new DraftPolishApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** The draft-polish API surface (session scope-free; the route fences itself). */
export const draftPolishApi = {
  polish: (payload: { sessionId?: string; text: string; provider?: string; model?: string }, signal?: AbortSignal) =>
    call<PolishResult>('polish', payload, signal),
  config: (signal?: AbortSignal) =>
    call<DraftPolishConfigView>('config', {}, signal),
  configUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<DraftPolishConfigEnvelope>('config.update', {
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
}
