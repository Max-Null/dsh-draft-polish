import { describe, expect, it, vi } from 'vitest'
import { DRAFT_POLISH_DEFAULTS, type DraftPolishConfig } from '../src/config.ts'
import { buildApi, buildContext, type ConfigFace } from '../src/host-api.ts'
import { DraftPolishError } from '../src/wire.ts'
import type { DraftPolishLlmService, DraftPolishSessionQueryService } from '../src/context-types.ts'

/** A streamed llm response: text deltas then a finish. */
async function* streamText(text: string, reason = 'complete'): AsyncIterable<Record<string, unknown>> {
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'finish', reason: { kind: reason } }
}

/** A context of two recent conversation turns. */
function surfaceEvents(): Array<Record<string, unknown>> {
  return [
    {
      type: 'user/message',
      seq: 1,
      time: 0,
      data: { content: [{ type: 'text', text: '第一个问题' }] },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: 0,
      data: { message: { content: [{ type: 'text', text: '第一个回答' }] } },
    },
    {
      type: 'user/message',
      seq: 3,
      time: 0,
      data: { content: [{ type: 'text', text: '第二个问题' }] },
    },
  ]
}

interface MockServices {
  llm: ReturnType<typeof vi.fn>
  readSurface: ReturnType<typeof vi.fn>
}

function mockServices(overrides: Partial<MockServices> = {}): MockServices {
  return {
    llm: overrides.llm ?? vi.fn(),
    readSurface: overrides.readSurface ?? vi.fn(),
  }
}

function ctxOf(services: MockServices): { llm: DraftPolishLlmService; sessionQuery: DraftPolishSessionQueryService } {
  return {
    llm: { stream: services.llm },
    sessionQuery: { readSurface: services.readSurface },
  } as unknown as { llm: DraftPolishLlmService; sessionQuery: DraftPolishSessionQueryService }
}

function configOf(patch: Partial<DraftPolishConfig> = {}): DraftPolishConfig {
  return { ...DRAFT_POLISH_DEFAULTS, ...patch }
}

function configFaceOf(update?: ConfigFace['update']): ConfigFace {
  return {
    get: () => ({ value: {}, revision: 1 }),
    update: update ?? vi.fn(async () => ({ value: {}, revision: 2 })),
  }
}

describe('buildApi.polish', () => {
  it('polishes a plain draft and returns the trimmed text', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('润色后的消息')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    const result = await api.polish({ text: ' 帮我看看这个报错 ' }) as { ok: boolean; text: string }
    expect(result).toEqual({ ok: true, text: '润色后的消息' })
    const call = services.llm.mock.calls[0][0] as { provider: string; model: string; system: string; messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.provider).toBe('deepseek-official')
    expect(call.model).toBe(DRAFT_POLISH_DEFAULTS.model)
    expect(call.messages[0].content[0].text).toContain('待润色草稿')
  })

  it('rejects an empty text', async () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    await expect(api.polish({ text: '   ' })).rejects.toThrow(DraftPolishError)
    await expect(api.polish({})).rejects.toThrow(DraftPolishError)
  })

  it('rejects when no provider is configured anywhere', async () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: '' }), () => undefined)
    await expect(api.polish({ text: '你好' })).rejects.toMatchObject({ code: 'no-provider' })
  })

  it('prefers the payload provider/model over the config', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('ok')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'cfg', model: 'cfg-model' }), () => undefined)
    await api.polish({ text: '你好', provider: 'payload', model: 'payload-model' })
    const call = services.llm.mock.calls[0][0] as { provider: string; model: string }
    expect(call.provider).toBe('payload')
    expect(call.model).toBe('payload-model')
  })

  it('marks a failed stream as an error', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('', 'aborted')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    await expect(api.polish({ text: '你好' })).rejects.toMatchObject({ code: 'stream-failed' })
  })

  it('rejects an empty model result', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('   ')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    await expect(api.polish({ text: '你好' })).rejects.toMatchObject({ code: 'empty-result' })
  })

  it('caps the draft at the input limit', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('ok')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    await api.polish({ text: 'x'.repeat(10_000) })
    const call = services.llm.mock.calls[0][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.messages[0].content[0].text.length).toBeLessThan(5000)
  })

  it('skips the surface read when context is disabled', async () => {
    const services = mockServices({ llm: vi.fn().mockReturnValue(streamText('ok')) })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official', contextEnabled: false }), () => undefined)
    await api.polish({ text: '你好', sessionId: 's1' })
    expect(services.readSurface).not.toHaveBeenCalled()
    const call = services.llm.mock.calls[0][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.messages[0].content[0].text).not.toContain('【近期对话】')
  })

  it('includes the recent conversation context by default', async () => {
    const services = mockServices({
      llm: vi.fn().mockReturnValue(streamText('ok')),
      readSurface: vi.fn().mockResolvedValue({ session: null, capturedThroughSeq: 3, events: surfaceEvents() }),
    })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official', contextEnabled: true, recentWindowMessages: 2 }), () => undefined)
    await api.polish({ text: '你好', sessionId: 's1' })
    expect(services.readSurface).toHaveBeenCalledWith('s1')
    const call = services.llm.mock.calls[0][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.messages[0].content[0].text).toContain('【近期对话】')
    expect(call.messages[0].content[0].text).toContain('第二个问题')
    expect(call.messages[0].content[0].text).not.toContain('第一个问题') // outside the recent window
  })

  it('degrades when the surface read fails', async () => {
    const services = mockServices({
      llm: vi.fn().mockReturnValue(streamText('ok')),
      readSurface: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const api = buildApi(ctxOf(services), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    const result = await api.polish({ text: '你好', sessionId: 's1' }) as { ok: boolean; text: string }
    expect(result.ok).toBe(true)
    const call = services.llm.mock.calls[0][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.messages[0].content[0].text).not.toContain('【近期对话】')
  })

  it('compresses the background and folds it into the prompt when enabled', async () => {
    const services = mockServices({
      llm: vi.fn()
        .mockReturnValueOnce(streamText('背景摘要'))
        .mockReturnValueOnce(streamText('润色后')),
      readSurface: vi.fn().mockResolvedValue({ session: null, capturedThroughSeq: 3, events: surfaceEvents() }),
    })
    const api = buildApi(
      ctxOf(services),
      () => configOf({ provider: 'deepseek-official', contextEnabled: true, backgroundEnabled: true, recentWindowMessages: 1, backgroundWindowMessages: 12 }),
      () => undefined,
    )
    const result = await api.polish({ text: '你好', sessionId: 's1' }) as { ok: boolean; text: string }
    expect(result.text).toBe('润色后')
    expect(services.llm).toHaveBeenCalledTimes(2)
    const mainCall = services.llm.mock.calls[1][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(mainCall.messages[0].content[0].text).toContain('【背景】')
    expect(mainCall.messages[0].content[0].text).toContain('背景摘要')
  })

  it('degrades to the recent window when the background compression fails', async () => {
    const services = mockServices({
      llm: vi.fn()
        .mockReturnValueOnce(streamText('', 'error'))
        .mockReturnValueOnce(streamText('润色后')),
      readSurface: vi.fn().mockResolvedValue({ session: null, capturedThroughSeq: 3, events: surfaceEvents() }),
    })
    const api = buildApi(
      ctxOf(services),
      () => configOf({ provider: 'deepseek-official', contextEnabled: true, backgroundEnabled: true, recentWindowMessages: 1, backgroundWindowMessages: 12 }),
      () => undefined,
    )
    const result = await api.polish({ text: '你好', sessionId: 's1' }) as { ok: boolean; text: string }
    expect(result.ok).toBe(true)
    const mainCall = services.llm.mock.calls[1][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(mainCall.messages[0].content[0].text).not.toContain('【背景】')
    expect(mainCall.messages[0].content[0].text).toContain('【近期对话】')
  })
})

describe('buildApi config methods', () => {
  it('returns the resolved config', () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'p' }), () => undefined)
    expect((api.config() as DraftPolishConfig).provider).toBe('p')
  })

  it('returns the revision-guarded face envelope', () => {
    const face = configFaceOf()
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => face)
    expect(api['config.get']()).toEqual({ value: {}, revision: 1 })
  })

  it('falls back to the plain config when no settings face exists', () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    expect((api['config.get']() as { value: DraftPolishConfig }).value.model).toBe(DRAFT_POLISH_DEFAULTS.model)
  })

  it('rejects a non-object patch', async () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => configFaceOf())
    await expect(api['config.update']({ patch: 42 })).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('surfaces settings conflicts as 409', async () => {
    const face = configFaceOf(vi.fn().mockRejectedValue({ code: 'SETTINGS_CONFLICT', message: 'conflict' }))
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => face)
    await expect(api['config.update']({ patch: { model: 'x' } })).rejects.toMatchObject({ code: 'settings-conflict' })
  })

  it('rejects updates when the settings service is absent', async () => {
    const api = buildApi(ctxOf(mockServices()), () => configOf({ provider: 'deepseek-official' }), () => undefined)
    await expect(api['config.update']({ patch: {} })).rejects.toMatchObject({ code: 'settings-rejected', status: 503 })
  })
})

describe('buildContext', () => {
  it('returns empty when context is disabled', async () => {
    const services = mockServices()
    const out = await buildContext(ctxOf(services), configOf({ contextEnabled: false }), 's1')
    expect(out).toBe('')
    expect(services.readSurface).not.toHaveBeenCalled()
  })

  it('returns empty without a session id', async () => {
    const out = await buildContext(ctxOf(mockServices()), configOf(), undefined)
    expect(out).toBe('')
  })
})
