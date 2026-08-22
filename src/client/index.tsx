/**
 * @max-null/dsh-draft-polish — web client half.
 *
 * Two registrations:
 * 1. `conversation.input.right` (the official "before the send button"
 *    tool-row seat) → PolishButton: reads the draft from the InputZone
 *    owner share, POSTs it to the host polish route (carrying the session
 *    id so the host can attach conversation context), and writes the
 *    polished text back through the standard-kit inputActions.setDraft.
 * 2. `settings.section` → PolishSettings: compact form over the host
 *    `draft-polish` settings namespace.
 *
 * The LLM call happens entirely on the host half — the browser bundle only
 * talks HTTP, so it stays dependency-free and the feature works while the
 * session is still generating.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PolishButton, type ResolvedModel } from './PolishButton.tsx'
import { PolishSettings } from './PolishSettings.tsx'

export const inject = ['slots', 'connection']

/** The minimal sessions RPC face used to inherit the session's model channel. */
interface SessionModelsRpc {
  api: {
    sessions: {
      models(payload: { sessionId: string }): Promise<{
        result: { ok: boolean; value?: { current?: { provider: string; model: string } } }
      }>
    }
  }
}

/**
 * Resolve the session's current model channel (provider/model) through the
 * sessions RPC — the same inherit path dsh-sidebar-qa uses. Undefined when
 * the RPC is unavailable or the session has no model selection.
 */
function resolveSessionModel(ctx: ClientContext, sessionId: string): Promise<ResolvedModel | undefined> {
  const connection = (ctx as unknown as { connection?: SessionModelsRpc }).connection
  if (connection === undefined) return Promise.resolve(undefined)
  return connection.api.sessions.models({ sessionId })
    .then((response) => {
      const current = response.result.ok ? response.result.value?.current : undefined
      if (current === undefined || current.provider === '') return undefined
      return { provider: current.provider, model: current.model }
    })
    .catch(() => undefined)
}

function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'draft-polish',
    order: 0,
    inject: () => ({
      resolveModel: (sessionId: string) => resolveSessionModel(ctx, sessionId),
    }),
  }, PolishButton))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'draft-polish',
    order: 50,
    label: () => settingsLabel(),
    inject: () => ({}),
  }, PolishSettings))

  // The settings shell has no icon contract for external sections; swap the
  // default gear for a sparkles glyph on our nav row (dsh-plugin-center pattern).
  ctx.effect?.(() => registerSettingsNavIcon(settingsLabel), 'dsh-draft-polish: settings navigation icon')
}

/** The settings tab label (zh/en via the document lang). */
function settingsLabel(): string {
  const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'zh').toLowerCase() : 'zh'
  return lang.startsWith('zh') ? '润色设置' : 'Polish'
}

// ── settings nav icon ─────────────────────────────────────────────────────
// DSH 0.1.x 的 settings.section 注册只投影 id/order/label，设置壳对外部 section
// 一律渲染默认齿轮（无 icon 契约字段）。照 dsh-plugin-center 的 settings-nav-icon
// 模式：MutationObserver 按当前本地化 label 标记设置对话框里本插件那一行，
// 由 CSS 把齿轮替换成 Lucide sparkles。标记不拥有壳结构，disposer 移除标记，HMR-safe。
const SETTINGS_NAV_MARKER = 'data-dsh-draft-polish-settings-nav'

/** Lucide `sparkles` as an SVG data-URI mask (currentColor, 16px, stroke-based). */
const SPARKLES_MASK_URL = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\'/%3E%3Cpath d=\'M20 3v4\'/%3E%3Cpath d=\'M22 5h-4\'/%3E%3Cpath d=\'M4 17v2\'/%3E%3Cpath d=\'M5 18H3\'/%3E%3C/svg%3E")'

const NAV_ICON_CSS = [
  `[${SETTINGS_NAV_MARKER}] > svg:first-child { display: none; }`,
  `[${SETTINGS_NAV_MARKER}]::before {`,
  "  content: '';",
  '  flex: none;',
  '  width: 16px;',
  '  height: 16px;',
  '  background: currentColor;',
  `  -webkit-mask: ${SPARKLES_MASK_URL} center / contain no-repeat;`,
  `  mask: ${SPARKLES_MASK_URL} center / contain no-repeat;`,
  '}',
].join('\n')

const NAV_ICON_STYLE_ID = '@max-null/dsh-draft-polish/settings-nav-icon.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${NAV_ICON_STYLE_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-draft-polish'
  tag.dataset.pluginCss = NAV_ICON_STYLE_ID
  tag.textContent = NAV_ICON_CSS
  document.head.appendChild(tag)
}

/** Mark (and unmark) the settings nav row whose label matches ours. */
function registerSettingsNavIcon(label: () => string): () => void {
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    const currentLabel = label().trim()
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')
    for (const button of buttons) {
      const matches = currentLabel.length > 0 && button.textContent?.trim() === currentLabel
      if (matches) button.setAttribute(SETTINGS_NAV_MARKER, '')
      else button.removeAttribute(SETTINGS_NAV_MARKER)
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => {
    disposed = true
    observer.disconnect()
    document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`)
      .forEach((element) => { element.removeAttribute(SETTINGS_NAV_MARKER) })
  }
}

export { apply, PolishButton, PolishSettings }
