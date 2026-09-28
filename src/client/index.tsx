/**
 * @max-null/dsh-draft-polish — web client half.
 *
 * Two registrations:
 * 1. `conversation.input.right` (the official "before the send button"
 *    tool-row seat) → PolishButton: reads the draft from the session input
 *    standard seat, POSTs it to the host polish route (carrying the session
 *    id so the host can attach conversation context), and writes the
 *    polished text back through the standard-kit inputActions.setDraft.
 * 2. `plugins.bundle.config` (key = package name) → PolishSettings: the
 *    configuration card on the plugin's own page under 「插件」. DSH 0.1.7
 *    removed `settings.plugin.item`, and `plugins.item` is the official
 *    settings pages' own section, so a bundle's configuration belongs here.
 *
 * The LLM call happens entirely on the host half — the browser bundle only
 * talks HTTP, so it stays dependency-free and the feature works while the
 * session is still generating.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the plugin page's SlotMap merge (the plugins.bundle.config entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the ctx.slots Context merge comes from the renderer package
// (slot registry), not from the removed dsh-client-runtime module.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PolishButton } from './PolishButton.tsx'
import { PolishSettings } from './PolishSettings.tsx'

export const inject = ['slots']

/** The bundle's package name — the key `plugins.bundle.config` registers under. */
const BUNDLE_KEY = '@max-null/dsh-draft-polish'

function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'draft-polish',
    order: 0,
  }, PolishButton))

  // 设置卡挂在插件自己的详情页：卡片自管理状态（无 settingsScope face），
  // 因此注册不提供 inject hooks。
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_KEY,
  }, PolishSettings))
}

export { apply, PolishButton, PolishSettings }
