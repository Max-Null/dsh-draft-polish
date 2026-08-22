/**
 * Pure helpers for the host polish service: fold the session surface into
 * ordered user/assistant segments, split them into the verbatim recent
 * window and the earlier background, and render both as the model context.
 *
 * Context-engineering strategy (inherited from dsh-sidebar-qa's summarize):
 * - The surface is split into a RECENT window (near-verbatim, no model) and
 *   an EARLIER background (optional heavy compression by the fast model).
 * - The model only ever compresses the EARLIER part; the recent part carries
 *   the current state verbatim, so the polish model knows what the user is
 *   discussing.
 * - The context is explicitly labeled "background only": the polish prompt
 *   must never quote it back into the polished draft.
 */
import type { DraftPolishStreamChunk, DraftPolishSurfaceEvent } from './context-types.ts'

/** Per-segment char cap for the verbatim recent window. */
export const RECENT_SEGMENT_MAX = 400

/** Per-segment char cap for the background window handed to the model. */
export const BACKGROUND_SEGMENT_MAX = 400

/** One user/assistant text segment in model-history order. */
export interface SurfaceSegment {
  role: 'user' | 'assistant'
  text: string
}

/** Bound a string to `max` characters (Unicode-safe slice + ellipsis). */
function bound(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}…`
}

/** Join the text blocks of one content array, skipping reasoning/tool noise. */
function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string' && record.text !== '') {
      parts.push(record.text)
    }
  }
  return parts.join('\n')
}

/** Extract the semantic text of one surface event ('' when non-text). */
export function textOfEvent(event: DraftPolishSurfaceEvent): string {
  switch (event.type) {
    case 'user/message': {
      const data = event.data as { content?: unknown; source?: { kind?: unknown } }
      const kind = data.source?.kind
      // Skip every non-human user/message: runtime-context snapshots and agent
      // notices (kind 'plugin') and the skills catalog (kind 'skill-catalog').
      if (kind !== undefined && kind !== 'user') return ''
      return textOfBlocks(data.content)
    }
    case 'assistant/message': {
      const data = event.data as { message?: { content?: unknown } }
      return textOfBlocks(data.message?.content)
    }
    default:
      // tool/result and anything else is tool/derived noise — excluded.
      return ''
  }
}

/** The role of one surface event ('assistant' for anything non-user). */
function roleOfEvent(event: DraftPolishSurfaceEvent): 'user' | 'assistant' {
  return event.type === 'user/message' ? 'user' : 'assistant'
}

/**
 * Fold the surface into ordered user/assistant segments (newest-last).
 * @param events - current surface events in model-history order.
 */
export function extractSegments(events: readonly DraftPolishSurfaceEvent[]): SurfaceSegment[] {
  const segments: SurfaceSegment[] = []
  for (const event of events) {
    const text = textOfEvent(event)
    if (text !== '') segments.push({ role: roleOfEvent(event), text })
  }
  return segments
}

/** Split segments into the EARLIER background and the RECENT verbatim window. */
export function splitRecent(
  segments: readonly SurfaceSegment[],
  recentCount: number,
): { earlier: SurfaceSegment[]; recent: SurfaceSegment[] } {
  const count = Math.max(0, recentCount)
  const recent = segments.slice(Math.max(0, segments.length - count))
  const earlier = segments.slice(0, Math.max(0, segments.length - count))
  return { earlier, recent }
}

/**
 * Render segments as role-labeled, turn-separated text (the model input for
 * the background, or the verbatim recent window).
 */
export function formatSegments(segments: readonly SurfaceSegment[], maxPerSegment: number): string {
  return segments
    .map(segment => `${segment.role === 'user' ? '用户' : '助手'}：${bound(segment.text, maxPerSegment)}`)
    .join('\n\n')
}

/**
 * Render the EARLIER background window for the model, NEWEST-FIRST. We want
 * the current progress (the tail of the earlier window — the messages just
 * before the verbatim recent band) to land at the model's strongest attention
 * position. The newest `count` of `earlier` are taken and reversed.
 */
export function formatBackground(
  earlier: readonly SurfaceSegment[],
  count: number,
  maxPerSegment: number,
): string {
  const take = Math.max(0, count)
  const newest = earlier.slice(Math.max(0, earlier.length - take)).reverse()
  return formatSegments(newest, maxPerSegment)
}

/**
 * Compose the final context block: the optional compressed background plus
 * the verbatim recent window. Either part may be absent; the whole block is
 * '' when the session has no usable conversation.
 */
export function composeContext(background: string, recent: string): string {
  const parts: string[] = []
  if (background.trim() !== '') parts.push(`【背景】\n${background}`)
  if (recent.trim() !== '') parts.push(`【近期对话】\n${recent}`)
  return parts.join('\n\n')
}

/** Result of assembling one stream: the accumulated text plus the terminal outcome. */
export interface AssembledText {
  text: string
  failed: boolean
}

/**
 * Accumulate the text deltas of one model stream until the terminal finish.
 * @param chunks - the `ctx.llm.stream` chunk iterable.
 * @returns the assembled text and whether the call errored or was aborted.
 */
export async function assembleText(chunks: AsyncIterable<DraftPolishStreamChunk>): Promise<AssembledText> {
  let text = ''
  let failed = false
  for await (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      const kind = chunk.reason.kind
      if (kind === 'error' || kind === 'aborted') failed = true
    }
  }
  return { text, failed }
}
