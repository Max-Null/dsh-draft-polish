/**
 * The host API method table (polish / config / config.get / config.update),
 * kept in an internal module so tests can drive it without a cordis runtime
 * while the package's public API surface stays minimal.
 */
import type { Context, DraftPolishLlmMessage, DraftPolishSettingsService } from './context-types.ts'
import { type DraftPolishConfig } from './config.ts'
import {
  assembleText,
  BACKGROUND_SEGMENT_MAX,
  composeContext,
  extractSegments,
  formatBackground,
  formatSegments,
  RECENT_SEGMENT_MAX,
  splitRecent,
} from './context.ts'
import { BACKGROUND_SYSTEM, buildPolishPrompt, POLISH_INPUT_MAX_CHARS, POLISH_SYSTEM } from './polish.ts'
import { DraftPolishError, optionalString, requireString } from './wire.ts'

/** One polish call result. */
export interface PolishResult {
  ok: boolean
  text: string | null
  reason?: string
}

/** The config namespace's live face: value + revision read, revision-guarded write. */
export interface ConfigFace {
  get(): { value?: unknown; revision?: number }
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/** One API method dispatch table entry (payload optional for config reads). */
type ApiMethod = (payload?: unknown) => Promise<unknown> | unknown

/** Generate a unique message id for a hand-built llm message. */
function randomId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID()
  return `dp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Build a user-role message carrying the text. */
function userMessage(text: string): DraftPolishLlmMessage {
  return {
    id: randomId(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-draft-polish' },
  }
}

/**
 * Assemble the conversation context block for one polish call. Any failure
 * degrades gracefully: the recent window alone still carries the current
 * state; a full failure leaves the context empty and the polish continues.
 */
export async function buildContext(
  ctx: Pick<Context, 'sessionQuery' | 'llm'>,
  config: DraftPolishConfig,
  sessionId: string | undefined,
): Promise<string> {
  if (!config.contextEnabled || sessionId === undefined) return ''
  let recent = ''
  let background = ''
  try {
    const surface = await ctx.sessionQuery.readSurface(sessionId)
    const { earlier, recent: recentSegments } = splitRecent(
      extractSegments(surface.events),
      config.recentWindowMessages,
    )
    recent = formatSegments(recentSegments, RECENT_SEGMENT_MAX)
    if (config.backgroundEnabled && earlier.length > 0) {
      try {
        const chunks = ctx.llm.stream({
          provider: config.provider,
          model: config.model,
          messages: [userMessage(formatBackground(earlier, config.backgroundWindowMessages, BACKGROUND_SEGMENT_MAX))],
          system: BACKGROUND_SYSTEM,
          maxTokens: config.backgroundBudgetTokens,
          reasoningEffort: config.reasoningEffort,
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        const assembled = await assembleText(chunks)
        if (!assembled.failed) background = assembled.text.trim()
      } catch {
        // background stays empty; the recent window still carries the state
      }
    }
  } catch {
    // surface read failed — the draft alone still gets polished
  }
  return composeContext(background, recent)
}

/** Build the API method table bound to the plugin context and its config face. */
export function buildApi(
  ctx: Pick<Context, 'llm' | 'sessionQuery'>,
  getConfig: () => DraftPolishConfig,
  getConfigFace: () => ConfigFace | undefined,
): Record<string, ApiMethod> {
  return {
    config: (): DraftPolishConfig => getConfig(),
    'config.get': (): { value?: unknown; revision?: number } => {
      const face = getConfigFace()
      return face?.get() ?? { value: getConfig(), revision: undefined }
    },
    'config.update': async (payload): Promise<{ value?: unknown; revision?: number }> => {
      const face = getConfigFace()
      if (face === undefined) {
        throw new DraftPolishError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new DraftPolishError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await face.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'SETTINGS_CONFLICT') {
          throw new DraftPolishError('settings-conflict', error instanceof Error ? error.message : String(error), 409)
        }
        throw new DraftPolishError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    polish: async (payload): Promise<PolishResult> => {
      const text = requireString(payload, 'text').slice(0, POLISH_INPUT_MAX_CHARS)
      const record = payload as { sessionId?: unknown; provider?: unknown; model?: unknown }
      const sessionId = typeof record.sessionId === 'string' && record.sessionId !== ''
        ? record.sessionId
        : undefined
      const config = getConfig()
      const provider = optionalString(record, 'provider') || config.provider
      const model = optionalString(record, 'model') || config.model

      if (provider === '') {
        throw new DraftPolishError('no-provider', '未配置模型渠道（provider 为空）')
      }

      const context = await buildContext(ctx, config, sessionId)
      const chunks = ctx.llm.stream({
        provider,
        model,
        messages: [userMessage(buildPolishPrompt(context, text))],
        system: POLISH_SYSTEM,
        maxTokens: config.budgetTokens,
        reasoningEffort: config.reasoningEffort,
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      const assembled = await assembleText(chunks)
      if (assembled.failed) {
        throw new DraftPolishError('stream-failed', '润色请求失败或超时')
      }
      const polished = assembled.text.trim()
      if (polished === '') {
        throw new DraftPolishError('empty-result', '润色失败：模型未返回内容')
      }
      return { ok: true, text: polished }
    },
  }
}
