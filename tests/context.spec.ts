import { describe, expect, it } from 'vitest'
import {
  assembleText,
  composeContext,
  extractSegments,
  formatBackground,
  formatSegments,
  splitRecent,
  textOfEvent,
  type SurfaceSegment,
} from '../src/context.ts'
import type { DraftPolishSurfaceEvent } from '../src/context-types.ts'

/** Build one surface event in model-history shape. */
function event(type: string, data: Record<string, unknown>): DraftPolishSurfaceEvent {
  return { type, seq: 0, time: 0, data }
}

const userEvent = (text: string, extra: Record<string, unknown> = {}) => event('user/message', {
  content: [{ type: 'text', text }],
  ...extra,
})

const assistantEvent = (text: string) => event('assistant/message', {
  message: { content: [{ type: 'text', text }] },
})

describe('textOfEvent', () => {
  it('reads user message text blocks', () => {
    expect(textOfEvent(userEvent('你好'))).toBe('你好')
  })

  it('skips non-human user messages (plugin-injected runtime-context snapshots)', () => {
    expect(textOfEvent(userEvent('Current runtime context...', { source: { kind: 'plugin' } }))).toBe('')
  })

  it('skips the skills catalog', () => {
    expect(textOfEvent(userEvent('skills catalog', { source: { kind: 'skill-catalog' } }))).toBe('')
  })

  it('keeps genuine human messages regardless of source.kind absence', () => {
    expect(textOfEvent(userEvent('普通提问'))).toBe('普通提问')
  })

  it('reads assistant message text blocks', () => {
    expect(textOfEvent(assistantEvent('回复内容'))).toBe('回复内容')
  })

  it('joins multiple text blocks with newlines and ignores non-text blocks', () => {
    const e = event('assistant/message', {
      message: { content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: '想' }, { type: 'text', text: 'b' }] },
    })
    expect(textOfEvent(e)).toBe('a\nb')
  })

  it('excludes tool/result and other derived noise', () => {
    expect(textOfEvent(event('tool/call', {}))).toBe('')
    expect(textOfEvent(event('tool/result', {}))).toBe('')
    expect(textOfEvent(event('command/run', {}))).toBe('')
  })
})

describe('extractSegments', () => {
  it('folds ordered user/assistant segments and drops empty ones', () => {
    const segments = extractSegments([
      userEvent(''),
      userEvent('问题一'),
      assistantEvent('回答一'),
      userEvent('runtime', { source: { kind: 'plugin' } }),
      assistantEvent(''),
    ])
    expect(segments).toEqual([
      { role: 'user', text: '问题一' },
      { role: 'assistant', text: '回答一' },
    ])
  })

  it('returns an empty list for an empty surface', () => {
    expect(extractSegments([])).toEqual([])
  })
})

describe('splitRecent / formatSegments / formatBackground', () => {
  const segments: SurfaceSegment[] = [
    { role: 'user', text: '第一条' },
    { role: 'assistant', text: '第二条' },
    { role: 'user', text: '第三条' },
  ]

  it('splits the verbatim recent window off the tail', () => {
    const { earlier, recent } = splitRecent(segments, 2)
    expect(earlier).toEqual([{ role: 'user', text: '第一条' }])
    expect(recent).toEqual([{ role: 'assistant', text: '第二条' }, { role: 'user', text: '第三条' }])
  })

  it('keeps everything recent when the window covers the whole surface', () => {
    const { earlier, recent } = splitRecent(segments, 10)
    expect(earlier).toEqual([])
    expect(recent).toEqual(segments)
  })

  it('clamps a negative window to zero', () => {
    const { earlier, recent } = splitRecent(segments, -1)
    expect(earlier).toEqual(segments)
    expect(recent).toEqual([])
  })

  it('renders role-labeled segments with per-segment caps', () => {
    const text = formatSegments([{ role: 'user', text: '长文本' }, { role: 'assistant', text: '短' }], 2)
    expect(text).toBe('用户：长文…\n\n助手：短')
  })

  it('renders the background newest-first', () => {
    const bg = formatBackground(segments, 2, 400)
    // newest two of the list, reversed: 第三条, 第二条
    expect(bg).toBe('用户：第三条\n\n助手：第二条')
  })

  it('clamps the background count', () => {
    expect(formatBackground(segments, 0, 400)).toBe('')
  })
})

describe('composeContext', () => {
  it('combines the background and the recent window', () => {
    expect(composeContext('背景摘要', '近期对话')).toBe('【背景】\n背景摘要\n\n【近期对话】\n近期对话')
  })

  it('omits absent parts', () => {
    expect(composeContext('', '近期对话')).toBe('【近期对话】\n近期对话')
    expect(composeContext('背景摘要', '')).toBe('【背景】\n背景摘要')
    expect(composeContext('', '')).toBe('')
  })

  it('trims whitespace-only parts away', () => {
    expect(composeContext('  ', '')).toBe('')
  })
})

describe('assembleText', () => {
  async function* chunks(items: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
    for (const item of items) yield item
  }

  it('accumulates text deltas until the finish chunk', async () => {
    const out = await assembleText(chunks([
      { type: 'text-delta', index: 0, text: '润' },
      { type: 'text-delta', index: 0, text: '色' },
      { type: 'finish', reason: { kind: 'complete' } },
    ]) as AsyncIterable<never>)
    expect(out).toEqual({ text: '润色', failed: false })
  })

  it('marks error and aborted finishes as failed', async () => {
    expect(await assembleText(chunks([
      { type: 'finish', reason: { kind: 'error' } },
    ]) as AsyncIterable<never>)).toEqual({ text: '', failed: true })
    expect(await assembleText(chunks([
      { type: 'finish', reason: { kind: 'aborted' } },
    ]) as AsyncIterable<never>)).toEqual({ text: '', failed: true })
  })
})
