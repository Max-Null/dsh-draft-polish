/**
 * Configuration for the host polish service. The user-facing knobs live in
 * the DSH settings service under the `draft-polish` namespace (schemastery
 * schema); deployments without a settings service fall back to
 * {@link DRAFT_POLISH_DEFAULTS}.
 *
 * 0.1.7 的两处变化（见 `settings/src/schema.ts` 与 `settings/src/index.ts`）：
 *   · 包名从裸 `schemastery` 迁到 `@deepseek-ai/schemastery`——只有后者有
 *     `.volatile()`（`lib/types/index.d.ts:156`）。
 *   · 每个可变字段都要标 `.volatile()`：`isVolatilePath` 只承认「祖先标了
 *     volatile」的路径，`settings/src/index.ts:406` 对非 volatile 路径直接抛错。
 * 注意 {@link DraftPolishConfig} 描述的是**裸值**形状（DEFAULTS 与 getConfig 的返回），
 * 不是 schema 的解析结果——`settings/src/schema.ts` 的 `plainConfig` 会把 volatile
 * 包装解包后再交给 `describe()` 的消费者，所以这个接口不需要改成 `Volatile<T>`。
 */
import z from '@deepseek-ai/schemastery'

/** Settings namespace id. */
export const DRAFT_POLISH_SETTINGS_NS = 'draft-polish'

/** DSH reasoning-effort vocabulary: Off / High / Max. */
export type DraftPolishReasoningEffort = 'off' | 'high' | 'max'

/** User-editable configuration. */
export interface DraftPolishConfig {
  // ── Model channel ────────────────────────────────────────────────────────
  /** Registered provider route for the polish model; '' = inherit the current session's provider (the client resolves it). */
  provider: string
  /** Polish chat model id (used when the client does not resolve a session model). */
  model: string
  /** Thinking effort for the polish model: Off / High / Max (polish wants Off). */
  reasoningEffort: DraftPolishReasoningEffort
  /** Output budget of the polished text, in tokens (soft bound). */
  budgetTokens: number
  /** Sampling temperature; low keeps the user's intent intact. */
  temperature: number
  /** Abort the polish call after this many milliseconds. */
  timeoutMs: number

  // ── Conversation context ──────────────────────────────────────────────────
  /** Whether the polish call carries the session's recent conversation as background context. */
  contextEnabled: boolean
  /** How many recent messages to keep VERBATIM (the current-state anchor). */
  recentWindowMessages: number
  /** Whether earlier messages are compressed into a short summary by the fast model. */
  backgroundEnabled: boolean
  /** How many earlier messages to hand to the background compression model. */
  backgroundWindowMessages: number
  /** Output budget of the background summary, in tokens (soft bound). */
  backgroundBudgetTokens: number
}

/** Schema-backed defaults (also used when the settings service is absent). */
export const DRAFT_POLISH_DEFAULTS: DraftPolishConfig = {
  provider: '',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'off',
  budgetTokens: 1024,
  temperature: 0.3,
  timeoutMs: 30_000,
  contextEnabled: true,
  recentWindowMessages: 4,
  backgroundEnabled: false,
  backgroundWindowMessages: 12,
  backgroundBudgetTokens: 160,
}

/** Schemastery schema for the `draft-polish` settings namespace.
 *  0.1.7：每个字段标 `.volatile()`，否则 settings 拒绝写入（见文件头注释）。 */
export const DraftPolishPrefsSchema = z.object({
  provider: z.string().default(DRAFT_POLISH_DEFAULTS.provider).volatile(),
  model: z.string().default(DRAFT_POLISH_DEFAULTS.model).volatile(),
  reasoningEffort: z.union(['off', 'high', 'max']).default(DRAFT_POLISH_DEFAULTS.reasoningEffort).volatile(),
  budgetTokens: z.number().step(1).min(64).max(8192).default(DRAFT_POLISH_DEFAULTS.budgetTokens).volatile(),
  temperature: z.number().step(0.05).min(0).max(1).default(DRAFT_POLISH_DEFAULTS.temperature).volatile(),
  timeoutMs: z.number().step(1000).min(5000).max(120000).default(DRAFT_POLISH_DEFAULTS.timeoutMs).volatile(),
  contextEnabled: z.boolean().default(DRAFT_POLISH_DEFAULTS.contextEnabled).volatile(),
  recentWindowMessages: z.number().step(1).min(1).max(32).default(DRAFT_POLISH_DEFAULTS.recentWindowMessages).volatile(),
  backgroundEnabled: z.boolean().default(DRAFT_POLISH_DEFAULTS.backgroundEnabled).volatile(),
  backgroundWindowMessages: z.number().step(1).min(1).max(128).default(DRAFT_POLISH_DEFAULTS.backgroundWindowMessages).volatile(),
  backgroundBudgetTokens: z.number().step(1).min(64).max(1024).default(DRAFT_POLISH_DEFAULTS.backgroundBudgetTokens).volatile(),
})
