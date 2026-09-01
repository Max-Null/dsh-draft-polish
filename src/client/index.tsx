/**
 * @max-null/dsh-draft-polish — web client half.
 *
 * Two registrations (DSH 0.1.2-alpha.2 contract):
 * 1. `conversation.input.right` (the official "before the send button"
 *    tool-row seat) → PolishButton: reads the draft from the session input
 *    standard seat, POSTs it to the host polish route (carrying the session
 *    id so the host can attach conversation context), and writes the
 *    polished text back through the standard-kit inputActions.setDraft.
 * 2. `settings.section` → PolishSettings: the settings dialog left-rail
 *    entry「润色设置」(sparkles glyph via the settings-nav marker,
 *    dsh-ssid-panels pattern). 用户定稿：设置只走左栏入口，不入
 *    官方「插件配置」tab（settings.plugin.item）聚合卡片。
 *
 * The LLM call happens entirely on the host half — the browser bundle only
 * talks HTTP, so it stays dependency-free and the feature works while the
 * session is still generating.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.slots Context merge comes from the renderer package
// (slot registry), not from the removed dsh-client-runtime module.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PolishButton } from './PolishButton.tsx'
import { PolishSettings } from './PolishSettings.tsx'

export const inject = ['slots']

function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'draft-polish',
    order: 0,
  }, PolishButton))

  // 设置对话框左栏入口（settings.section 在 alpha.2 仍声明；真正退役的是
  // settings.general.item）。用户定稿：唯一设置入口。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'draft-polish',
    order: 50,
    label: () => settingsLabel(),
    inject: () => ({}),
  }, PolishSettings))

  // 设置壳对本插件左栏行没有 icon 契约（照 dsh-ssid-panels 模式：
  // MutationObserver 按 label 标记本行，由 CSS 把齿轮替换成 sparkles）。
  ctx.effect?.(() => registerSettingsNavIcon(settingsLabel), 'dsh-draft-polish: settings navigation icon')
}

/** The settings tab label (zh/en via the document lang). */
function settingsLabel(): string {
  const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'zh').toLowerCase() : 'zh'
  return lang.startsWith('zh') ? '润色设置' : 'Polish'
}

// ── settings nav icon ─────────────────────────────────────────────────────
// DSH 0.1.x 的 settings.section 注册只投影 id/order/label，设置壳对外部 section
// 一律渲染默认齿轮（无 icon 契约字段）。照 dsh-ssid-panels 的 settings-nav-icon
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
