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
import { buildApi, buildContext, type ConfigFace, type DefaultChannel } from './host-api.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { DraftPolishError, readJsonBody, writeError, writeJson, writeOk } from './wire.ts'
import type { DraftPolishSettingsService } from './context-types.ts'

export { DRAFT_POLISH_DEFAULTS, DRAFT_POLISH_SETTINGS_NS } from './config.ts'
export type { DraftPolishConfig, DraftPolishReasoningEffort } from './config.ts'

/**
 * 插件配置 schema —— **必须是 `Config` 这个导出名**。
 *
 * DSH 的 settings 服务靠 `entry.fiber.runtime.Config` 认领一个插件的设置区
 * （`settings/src/index.ts:425-428` 的 `schema(entry)`），再由 `volatileForm(schema)`
 * 判断它有没有可编辑字段（`:385-386`：无 volatile 字段的插件整条跳过，不出现在
 * `describe()` 里）。本插件此前只导出 `DraftPolishPrefsSchema`，名字对不上，
 * 于是 settings 根本不认它——叠加旧代码吞掉 `register` 的异常，就成了
 * 「全部润色设置静默失效、界面毫无异常」。这里把 schema 按契约名导出。
 *
 * 别名导出不影响其他引用：`DraftPolishPrefsSchema` 的名字保持不变。
 */
export { DraftPolishPrefsSchema as Config } from './config.ts'
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
  let configFace: ConfigFace | undefined
  ctx.inject(['settings'], (sctx) => {
    const settingsService = sctx.settings as unknown as DraftPolishSettingsService
    // 0.1.7：Settings 不再有 `register`——插件的 Config schema 本身就构成它的
    // settings section（`settings/src/schema.ts` 的 `volatileForm` 由 loader 依据本
    // 插件导出的 schema 推导），namespace 即 entry id（`draft-polish`）。这里只保留
    // 读值与写值，`describe` 与 `update` 在 0.1.7 仍然存在（`settings/src/index.ts:302,347`）。
    //
    // 这里**刻意不吞异常**：旧代码把 `register` 抛出的 TypeError 收进一行 `console.warn`，
    // 结果是「全部润色设置静默失效、界面没有任何异常」——最难排查的一类故障。加载期
    // 直接抛错，可见即可修。
    const viewOf = (): { value?: unknown, revision?: number } => {
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
  })
  // `describe()` 的 value 已被 `settings/src/schema.ts` 的 `plainConfig` 解包过 volatile，
  // 所以这里拿到的就是裸 {@link DraftPolishConfig}，无需再 `.get()`。
  const getConfig = (): DraftPolishConfig =>
    (configFace?.get().value as DraftPolishConfig | undefined) ?? DRAFT_POLISH_DEFAULTS

  // ── Default channel ───────────────────────────────────────────────────────
  // DSH 默认模型渠道（agent-default-model，会话创建时应用的选择）：客户端未
  // 携带会话投影（无请求记录的新会话）或未配置 provider 时，润色用它兜底。
  let resolveDefaultChannel: (() => DefaultChannel | undefined) | undefined
  ctx.inject(['agentDefaultModel'], (actx) => {
    if (actx.agentDefaultModel === undefined) return
    resolveDefaultChannel = () => actx.agentDefaultModel.currentSelection() ?? undefined
  })

  // ── JSON API ──────────────────────────────────────────────────────────────
  const api = buildApi(ctx, getConfig, () => configFace, () => resolveDefaultChannel?.())
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
