// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PolishButton, type PolishButtonProps } from '../../src/client/PolishButton.tsx'

/** The host config response (defaults with an empty provider → inherit path). */
const CONFIG_VALUE = {
  provider: '',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'off',
  budgetTokens: 1024,
  temperature: 0.3,
  timeoutMs: 30000,
  contextEnabled: true,
  recentWindowMessages: 4,
  backgroundEnabled: false,
  backgroundWindowMessages: 12,
  backgroundBudgetTokens: 160,
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: status < 400, value }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch stub that answers /config immediately and routes /polish to a hook. */
function stubFetch(polishHandler: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn((url: string | URL | Request) => {
    if (String(url).includes('/config')) return Promise.resolve(jsonResponse(CONFIG_VALUE))
    return polishHandler()
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Mount the button with given props; returns the rendered button element. */
function mount(props: PolishButtonProps): { button: HTMLButtonElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(PolishButton, props)) })
  const button = container.querySelector('button') as HTMLButtonElement
  return {
    button,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** The body of the last /api/polish fetch call ('' when none). */
function lastPolishBody(mock: ReturnType<typeof vi.fn>): string {
  const call = [...mock.mock.calls].reverse().find(call => String(call[0]).includes('/api/polish'))
  return (call?.[1] as RequestInit | undefined)?.body as string ?? ''
}

/** Flush the microtask queue so fetch promise chains settle inside act(). */
async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

/** A stand-in for the session standard seat `useInput` over a draft value. */
function useInputOf(draft: string): PolishButtonProps['useInput'] {
  return (selector) => selector({ draft })
}

describe('PolishButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not call the API and shows a hint when the draft is empty', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({})))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('   '), inputActions: { setDraft: vi.fn() } })
    act(() => { button.click() })
    expect(lastPolishBody(fetchMock)).toBe('')
    expect(document.querySelector('.dpp2-toast')?.textContent).toContain('请先输入内容')
    unmount()
  })

  it('posts the draft with the session id and writes the result back via setDraft', async () => {
    const setDraft = vi.fn()
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true, text: '润色后的消息' })))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('帮我看看'), inputActions: { setDraft } })
    act(() => { button.click() })
    await flush()
    expect(setDraft).toHaveBeenCalledWith('润色后的消息')
    expect(document.querySelector('.dpp2-toast')?.textContent).toContain('已润色')
    unmount()
  })

  it('falls back to the legacy input owner share when the standard seat is absent', async () => {
    const setDraft = vi.fn()
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true, text: '润色结果' })))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', input: { draft: '旧通道草稿' }, inputActions: { setDraft } })
    act(() => { button.click() })
    await flush()
    const parsed = JSON.parse(lastPolishBody(fetchMock)) as { text?: string }
    expect(parsed.text).toBe('旧通道草稿')
    unmount()
  })

  it('inherits the session channel via the modelSelection projection when no provider is configured', async () => {
    const setDraft = vi.fn()
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true, text: '润色结果' })))
    document.documentElement.lang = 'zh'
    const useProjection = vi.fn(() => ({
      lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      next: null,
    }))
    const { button, unmount } = mount({
      sessionId: 's1',
      useInput: useInputOf('草稿'),
      inputActions: { setDraft },
      useProjection,
    })
    act(() => { button.click() })
    await flush()
    expect(useProjection).toHaveBeenCalledWith('modelSelection')
    const parsed = JSON.parse(lastPolishBody(fetchMock)) as { provider?: string; model?: string }
    expect(parsed.provider).toBe('deepseek-official')
    expect(parsed.model).toBe('deepseek-v4-pro')
    unmount()
  })

  it('uses the configured provider from the config route ahead of the projection', async () => {
    const setDraft = vi.fn()
    const fetchMock = vi.fn((url: string | URL | Request) => {
      if (String(url).includes('/config')) {
        return Promise.resolve(jsonResponse({ ...CONFIG_VALUE, provider: 'custom-provider', model: 'custom-model' }))
      }
      return Promise.resolve(jsonResponse({ ok: true, text: '润色结果' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    document.documentElement.lang = 'zh'
    const useProjection = vi.fn(() => ({
      lastUsed: { provider: 'session-provider', model: 'session-model' },
      next: null,
    }))
    const { button, unmount } = mount({
      sessionId: 's1',
      useInput: useInputOf('草稿'),
      inputActions: { setDraft },
      useProjection,
    })
    // Wait for the config preload to land, then click.
    await flush()
    act(() => { button.click() })
    await flush()
    const parsed = JSON.parse(lastPolishBody(fetchMock)) as { provider?: string; model?: string }
    expect(parsed.provider).toBe('custom-provider')
    expect(parsed.model).toBe('custom-model')
    unmount()
  })

  it('keeps the sparkles glyph with the busy state while the request is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    stubFetch(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('草稿'), inputActions: { setDraft: vi.fn() } })
    act(() => { button.click() })
    await flush()
    expect(button.getAttribute('data-loading')).toBe('true')
    expect(button.disabled).toBe(true)
    // The sparkles glyph stays (no spinner swap), and no busy toast appears.
    expect(button.querySelector('.dpp2-sparkle')).not.toBeNull()
    expect(document.querySelector('.dpp2-toast')).toBeNull()
    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, text: '润色结果' }))
      await Promise.resolve()
    })
    expect(button.getAttribute('data-loading')).toBe('false')
    unmount()
  })

  it('does not fire twice while a request is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('草稿'), inputActions: { setDraft: vi.fn() } })
    act(() => { button.click() })
    await flush() // the first polish request is now in flight
    act(() => { button.click() })
    await flush()
    const polishCalls = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/polish'))
    expect(polishCalls).toHaveLength(1)
    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, text: '润色结果' }))
      await Promise.resolve()
    })
    unmount()
  })

  it('shows the failure reason on an API error and keeps the draft', async () => {
    const setDraft = vi.fn()
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({ ok: false, error: { code: 'stream-failed', message: '润色请求失败或超时' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('草稿'), inputActions: { setDraft } })
    act(() => { button.click() })
    await flush()
    expect(setDraft).not.toHaveBeenCalled()
    expect(document.querySelector('.dpp2-toast')?.textContent).toContain('润色失败')
    expect(document.querySelector('.dpp2-toast')?.textContent).toContain('润色请求失败或超时')
    unmount()
  })

  it('tolerates an absent inputActions (inert seat) without crashing', () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true, text: '结果' })))
    document.documentElement.lang = 'zh'
    const { button, unmount } = mount({ sessionId: 's1', useInput: useInputOf('草稿') })
    act(() => { button.click() })
    unmount()
  })
})
