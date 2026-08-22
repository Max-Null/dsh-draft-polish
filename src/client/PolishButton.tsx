/**
 * PolishButton: the composer's right-tool-seat entry (conversation.input.right
 * — the official "before the send button" seat). Reads the draft from the
 * InputZone owner share, POSTs it to the host polish route (with the session
 * id for context), and writes the polished text back through the standard-kit
 * inputActions.setDraft.
 *
 * Deliberately thin: all LLM work happens on the host half, so the browser
 * bundle stays dependency-free and the request works while the session is
 * still generating (the host llm service is decoupled from session
 * scheduling).
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { draftPolishApi, DraftPolishApiError } from './api.ts'

/** The props this entry reads (the runtime passes far more; these are the
 *  contract slices: InputZone owner + the standard-kit input actions). */
export interface PolishButtonProps {
  sessionId?: string
  input?: { draft: string }
  inputActions?: { setDraft(text: string): void }
  /** Resolve the session's current model channel (the inherit path). */
  resolveModel?: (sessionId: string) => Promise<ResolvedModel | undefined>
}

/** A resolved model channel (provider + model id). */
export interface ResolvedModel {
  provider: string
  model: string
}

/** Product copy (zh/en via the document lang, same pattern as dsh-chat-rail). */
const STRINGS: Record<string, Record<string, string>> = {
  zh: {
    button: '润色',
    tooltip: '调用 AI 润色草稿（可携带会话上下文）',
    empty: '请先输入内容',
    loading: '润色中…',
    done: '已润色',
    error: '润色失败：',
  },
  en: {
    button: 'Polish',
    tooltip: 'Polish the draft with AI (with conversation context)',
    empty: 'Type something first',
    loading: 'Polishing…',
    done: 'Polished',
    error: 'Polish failed: ',
  },
}

function langStrings(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'zh').toLowerCase() : 'zh'
  return STRINGS[lang.startsWith('zh') ? 'zh' : 'en']
}

/** The button style sheet (one <style data-plugin> tag, theme-variable driven). */
const CSS = [
  '.dpp2-wrap{position:relative;display:grid;place-items:center}',
  // Seat the polish button visually BETWEEN the context meter and the send
  // button without touching DSH sources. Every renderSlot site is wrapped in
  // a display:contents div[data-slot="<key>"] — the addressable seam DSH
  // provides for dynamic styling. In the flex trailing row the flex items
  // are: the wrap (transparently promoted through its contents anchor), the
  // model seat's contents, the ContextMeter, then the send/stop buttons.
  // `order` re-sequences the visuals: our wrap moves after the order-0 model
  // seat + ContextMeter, and the send/stop buttons (later siblings of the
  // input.right anchor, matched by an aria-label substring only they carry)
  // are pushed past us. DOM/tab order stays upstream; if DSH renames the
  // button copy the rule degrades to "polish at the row's end", never breaks.
  '.dpp2-wrap{order:2}',
  '[data-slot="conversation.input.right"] ~ button[aria-label*="消息"],[data-slot="conversation.input.right"] ~ button[aria-label*="生成"],[data-slot="conversation.input.right"] ~ button[aria-label*="message"],[data-slot="conversation.input.right"] ~ button[aria-label*="generating"]{order:3}',
  '.dpp2-btn{background:0 0;border:none;border-radius:999px;width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;place-items:center;display:grid;flex:none;transition:background-color .15s,color .15s,opacity .15s;padding:0}',
  '.dpp2-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}',
  '.dpp2-btn:disabled{opacity:.4;cursor:default}',
  // Busy: brand-tinted fill + the sparkles glyph itself breathes (scale +
  // opacity pulse) — unmistakable mid-polish feedback, icon stays recognizable.
  '.dpp2-btn[data-loading=true]{opacity:1;cursor:progress;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary)}',
  '.dpp2-btn[data-loading=true] .dpp2-sparkle{animation:dpp2-breathe 1.2s ease-in-out infinite;transform-origin:center}',
  '@keyframes dpp2-breathe{0%,100%{opacity:.45;transform:scale(.82)}50%{opacity:1;transform:scale(1.12)}}',
  '.dpp2-toast{position:fixed;bottom:80px;left:50%;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font-size:13px;line-height:20px;pointer-events:none;z-index:9999;white-space:nowrap;transform:translate(-50%,0);animation:dpp2-fade .15s ease-out;max-width:70vw;overflow:hidden;text-overflow:ellipsis}',
  '.dpp2-toast[data-error=true] span{color:var(--dsw-alias-state-error-primary)}',
  '@keyframes dpp2-fade{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}',
].join('')

const STYLE_ID = '@max-null/dsh-draft-polish/polish-button.css'
if (typeof document !== 'undefined') {
  // Idempotent replace: a previously injected style with the same id (e.g. an
  // older bundle version already loaded in this page) must never shadow the
  // current CSS — drop it, then insert fresh.
  document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)?.remove()
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-draft-polish'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function IconSparkle(): ReactNode {
  return createElement('svg', {
    viewBox: '0 0 16 16',
    width: '15',
    height: '15',
    fill: 'none',
    'aria-hidden': true,
    className: 'dpp2-sparkle',
  }, createElement('path', {
    d: 'M8 1.2c.3 0 .56.18.67.46l1.5 3.9 3.9 1.5a.72.72 0 0 1 0 1.34l-3.9 1.5-1.5 3.9a.72.72 0 0 1-1.34 0l-1.5-3.9-3.9-1.5a.72.72 0 0 1 0-1.34l3.9-1.5 1.5-3.9A.72.72 0 0 1 8 1.2ZM12.5 9c.2 0 .37.12.44.31l.65 1.65 1.65.65a.48.48 0 0 1 0 .88l-1.65.65-.65 1.65a.48.48 0 0 1-.88 0l-.65-1.65-1.65-.65a.48.48 0 0 1 0-.88l1.65-.65.65-1.65A.48.48 0 0 1 12.5 9Z',
    fill: 'currentColor',
  }))
}

/** One-click AI polish: draft → host → setDraft. */
export function PolishButton(props: PolishButtonProps): ReactNode {
  const t = langStrings()
  const draft = props.input?.draft ?? ''
  const setDraft = props.inputActions?.setDraft
  const resolveModel = props.resolveModel

  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const toastTimer = useRef(0)
  // The plugin's configured channel (provider/model), loaded once; empty
  // strings mean "inherit the session's current channel".
  const [config, setConfig] = useState<{ provider: string; model: string }>({ provider: '', model: '' })

  const showToast = useCallback((text: string, error: boolean): void => {
    setToast({ text, error })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => { setToast(null) }, 2500)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // Preload the plugin config (channel inheritance resolution is cheap and
  // the fetch is local HTTP; a failure just leaves the inherit path).
  useEffect(() => {
    let cancelled = false
    draftPolishApi.config()
      .then((view) => {
        if (!cancelled) setConfig({ provider: view.provider, model: view.model })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleClick = useCallback((): void => {
    if (loading) return
    if (draft.trim() === '') {
      showToast(t.empty, false)
      return
    }
    setLoading(true)
    const payload: { sessionId?: string; text: string; provider?: string; model?: string } = {
      sessionId: props.sessionId,
      text: draft,
    }
    const inherit = (): Promise<void> => {
      if (config.provider !== '') payload.provider = config.provider
      if (config.model !== '') payload.model = config.model
      if (payload.provider !== undefined || props.sessionId === undefined || resolveModel === undefined) {
        return Promise.resolve()
      }
      // No configured provider: inherit the session's current channel.
      return resolveModel(props.sessionId).then((resolved) => {
        if (resolved !== undefined) {
          payload.provider = resolved.provider
          if (payload.model === undefined) payload.model = resolved.model
        }
      })
    }
    inherit()
      .then(() => draftPolishApi.polish(payload))
      .then((result) => {
        if (result.ok && result.text !== null && typeof setDraft === 'function') {
          setDraft(result.text)
          showToast(t.done, false)
        } else {
          showToast(t.error + (result.reason ?? 'empty result'), true)
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof DraftPolishApiError
          ? error.message
          : error instanceof Error ? error.message : String(error)
        showToast(t.error + message, true)
      })
      .finally(() => { setLoading(false) })
  }, [loading, draft, props.sessionId, config.provider, config.model, resolveModel, setDraft, showToast, t])

  return createElement('div', { className: 'dpp2-wrap' }, [
    createElement('button', {
      key: 'btn',
      type: 'button',
      className: 'dpp2-btn',
      'data-loading': loading ? 'true' : 'false',
      disabled: loading,
      'aria-label': t.button,
      title: t.tooltip,
      onClick: handleClick,
    }, IconSparkle()),
    toast !== null
      ? createElement('div', { key: 'toast', className: 'dpp2-toast' },
        createElement('span', { 'data-error': toast.error ? 'true' : 'false' }, toast.text))
      : null,
  ])
}
