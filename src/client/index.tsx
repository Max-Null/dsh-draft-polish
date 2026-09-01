/**
 * @max-null/dsh-draft-polish — web client half.
 *
 * Two registrations (DSH 0.1.2-alpha.2 contract):
 * 1. `conversation.input.right` (the official "before the send button"
 *    tool-row seat) → PolishButton: reads the draft from the InputZone
 *    owner share, POSTs it to the host polish route (carrying the session
 *    id so the host can attach conversation context), and writes the
 *    polished text back through the standard-kit inputActions.setDraft.
 * 2. `settings.plugin.item` (the configurable-plugins tab card, keyed by
 *    the `draft-polish` settings namespace) → PolishSettings.
 *
 * The LLM call happens entirely on the host half — the browser bundle only
 * talks HTTP, so it stays dependency-free and the feature works while the
 * session is still generating.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.plugin.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the ctx.slots Context merge comes from the renderer package
// (slot registry), not from the removed dsh-client-runtime module.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PolishButton } from './PolishButton.tsx'
import { PolishSettings } from './PolishSettings.tsx'

export const inject = ['slots']

/**
 * The `draft-polish` settings namespace id (mirror of the host config.ts
 * constant; imported here would pull schemastery into the browser bundle).
 */
const SETTINGS_NS = 'draft-polish'

function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'draft-polish',
    order: 0,
  }, PolishButton))

  // alpha.2：General 区 slot（settings.general.item）已退役，插件设置接入
  // 官方「可配置插件」Tab 的 settings.plugin.item（keyed by namespace）——
  // 官方卡片姿势见 dsh-client-ui-settings-plugins/src/client/index.ts。
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NS,
    // 卡片自身通过 /draft-polish/api/config 读写（无 settingsScope face）：
    // npm ui-slots 类型未合并 keyed-slot 选项（官方 monorepo 类型才有）——
    // 运行时与官方源码一致，类型期放宽（官方类型同步后收紧）。
  } as never, PolishSettings))
}

export { apply, PolishButton, PolishSettings }
