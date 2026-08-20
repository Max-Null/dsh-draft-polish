/**
 * dsh-draft-polish host half: the /draft-polish/api JSON API (polish,
 * config) and the `draft-polish` settings namespace.
 *
 * The polish method reads the session's current model surface through
 * `ctx.sessionQuery.readSurface`, optionally compresses the earlier
 * background through the fast model (`ctx.llm.stream`), assembles the
 * polish prompt (context + draft), and streams the polished text back.
 *
 * Why this works while the session is still generating (the OC pain point):
 * `ctx.llm` is an independent capability decoupled from agent-session
 * scheduling, and `readSurface` is a read-only projection of the session
 * log — neither blocks nor is blocked by an in-flight turn.
 *
 * The route passes the same browser-trust fence as the /api gateway
 * (Host-header loopback or the connection row's `trustedHosts`).
 */
import type { IncomingMessage } from 'node:http'
import type { Context } from './context-types.ts'
import {
  DRAFT_POLISH_DEFAULTS,
  DRAFT_POLISH_SETTINGS_NS,
  DraftPolishPrefsSchema,
  type DraftPolishConfig,
} from './config.ts'
import { buildApi, buildContext, type ConfigFace } from './host-api.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { DraftPolishError, readJsonBody, writeError, writeJson, writeOk } from './wire.ts'
import type { DraftPolishSettingsScope, DraftPolishSettingsService } from './context-types.ts'

export { DRAFT_POLISH_DEFAULTS, DRAFT_POLISH_SETTINGS_NS } from './config.ts'
export type { DraftPolishConfig, DraftPolishReasoningEffort } from './config.ts'
export type { Context } from './context-types.ts'
export {
  assembleText,
  composeContext,
  extractSegments,
  formatBackground,
  formatSegments,
  splitRecent,
  textOfEvent,
} from './context.ts'
export { BACKGROUND_SYSTEM, buildPolishPrompt, POLISH_SYSTEM } from './polish.ts'
export type { PolishResult } from './host-api.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-draft-polish'

/** Services required before mounting: the webserver routes, the session query engine, and the llm runtime. */
export const inject = ['webServer', 'sessionQuery', 'llm', 'loader']

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

/**
 * Plugin body: mount the fenced route and the optional settings namespace.
 * @param ctx - host plugin context (webServer, sessionQuery, llm, loader).
 */
export function apply(ctx: Context): void {
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHostsOf(ctx))

  // ── User-editable configuration ───────────────────────────────────────────
  // The `draft-polish` namespace is optional: deployments without a settings
  // service fall back to DRAFT_POLISH_DEFAULTS and the polish route still
  // answers. The registration is defensive — a refusal must never disable
  // the plugin.
  let configScope: DraftPolishSettingsScope<DraftPolishConfig> | undefined
  let configFace: ConfigFace | undefined
  ctx.inject(['settings'], (sctx) => {
    const settingsService = sctx.settings as unknown as DraftPolishSettingsService
    try {
      configScope = settingsService.register<DraftPolishConfig>(DRAFT_POLISH_SETTINGS_NS, DraftPolishPrefsSchema)
      const viewOf = (): { value?: unknown; revision?: number } => {
        const descriptor = settingsService
          .describe({ redactSecrets: true })
          .find(candidate => candidate.ns === DRAFT_POLISH_SETTINGS_NS)
        return descriptor === undefined
          ? { value: undefined, revision: undefined }
          : { value: descriptor.value, revision: descriptor.revision }
      }
      configFace = {
        get: viewOf,
        update: async (patch, expectedRevision) => {
          await settingsService.update(DRAFT_POLISH_SETTINGS_NS, patch, expectedRevision)
          return viewOf()
        },
      }
    } catch (error) {
      console.warn('[dsh-draft-polish] settings registration failed; using defaults:', error)
    }
  })
  const getConfig = (): DraftPolishConfig => {
    try {
      return configScope?.get() ?? DRAFT_POLISH_DEFAULTS
    } catch {
      return DRAFT_POLISH_DEFAULTS
    }
  }

  // ── JSON API ──────────────────────────────────────────────────────────────
  const api = buildApi(ctx, getConfig, () => configFace)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/draft-polish/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/draft-polish/api/') ? pathname.slice('/draft-polish/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new DraftPolishError('not-found', 'unknown draft-polish API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new DraftPolishError('not-found', `unknown draft-polish API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-draft-polish: /draft-polish/api routes')
}
