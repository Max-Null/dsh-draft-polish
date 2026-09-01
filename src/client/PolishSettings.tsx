/**
 * PolishSettings: the settings.plugin.item card (DSH 0.1.2-alpha.2 — the
 * configurable-plugins tab entry keyed by the `draft-polish` namespace) — a
 * compact form over the host `draft-polish` settings namespace (fetched and
 * saved through the /draft-polish/api/config routes). Deliberately minimal:
 * only the knobs a user realistically touches live here; everything else
 * keeps defaults. The card manages its own state (no settingsScope face),
 * so the register call supplies no inject hooks.
 *
 * Styling follows the DSH native settings language (ui-settings-plugins
 * `fields.module.css`): stacked fields with border-top separators, 13px
 * 500-weight labels, 34px inputs on `--dsw-alias-bg-layer-3` with
 * `--dsw-alias-brand-primary` focus, 12px tertiary hints.
 */
import { createElement, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { draftPolishApi, DraftPolishApiError, type DraftPolishConfigView } from './api.ts'

/** Product copy (zh/en via the document lang). */
const STRINGS: Record<string, Record<string, string>> = {
  zh: {
    settingsNav: '润色设置',
    setTitle: '草稿润色',
    setSubtitle: '配置润色按钮使用的模型渠道与上下文策略。默认复用 DSH 现有渠道，开箱即用。',
    setContext: '携带会话上下文',
    setContextHint: '把最近对话带给模型，帮助它理解你的意图（参考 dsh-sidebar-qa 机制）',
    setProvider: 'Provider',
    setProviderHint: '留空则继承当前会话的模型渠道',
    setModel: '模型',
    setModelHint: '润色使用的模型 id',
    setRecent: '近期对话条数',
    setRecentHint: '原文保留的最近消息数（每段 ≤400 字符）',
    setBackground: '压缩更早背景',
    setBackgroundHint: '开启后多一次快速模型调用，把更早对话压成 ≤3 句摘要',
    setBackgroundWindow: '背景窗口条数',
    setTemp: '温度',
    setTempHint: '低随机性保原意（0–1）',
    setTimeout: '超时（毫秒）',
    setSave: '保存',
    setSaving: '保存中…',
    setSaved: '✓ 已保存，改动即时生效',
    setLoadFail: '配置加载失败，请刷新重试',
    setSaveFail: '保存失败：',
  },
  en: {
    settingsNav: 'Polish',
    setTitle: 'Draft Polish',
    setSubtitle: 'Configure the model channel and context strategy for the polish button. Reuses the DSH channel by default — works out of the box.',
    setContext: 'Carry conversation context',
    setContextHint: 'Attach the recent conversation so the model understands your intent',
    setProvider: 'Provider',
    setProviderHint: 'Empty inherits the current session channel',
    setModel: 'Model',
    setModelHint: 'The model id used for polishing',
    setRecent: 'Recent messages',
    setRecentHint: 'Verbatim recent window (≤400 chars per segment)',
    setBackground: 'Compress earlier background',
    setBackgroundHint: 'One extra fast-model call; compresses earlier turns into a ≤3-sentence summary',
    setBackgroundWindow: 'Background window (messages)',
    setTemp: 'Temperature',
    setTempHint: 'Low keeps your intent intact (0–1)',
    setTimeout: 'Timeout (ms)',
    setSave: 'Save',
    setSaving: 'Saving…',
    setSaved: '✓ Saved, changes take effect immediately',
    setLoadFail: 'Failed to load config, please refresh',
    setSaveFail: 'Save failed: ',
  },
}

function langStrings(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'zh').toLowerCase() : 'zh'
  return STRINGS[lang.startsWith('zh') ? 'zh' : 'en']
}

/** The settings sheet style — the DSH native settings field language. */
const CSS = [
  '.dpf{max-width:560px;display:flex;flex-direction:column;width:100%}',
  '.dpf-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
  '.dpf-field+.dpf-field{border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dpf-head{display:flex;align-items:center;gap:8px}',
  '.dpf-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
  // 家族开关（dsh-ssid-panels 通知设置同款：40x22 胶囊 + 白色圆钮）。
  '.dpf-switch{width:40px;height:22px;flex:none;border:none;border-radius:11px;cursor:pointer;padding:0;background:var(--dsw-alias-border-l4,rgba(0,0,0,.16));transition:background .15s}',
  '.dpf-switch.on{background:var(--dsw-alias-state-business-primary,#4FC3F7)}',
  '.dpf-switch .knob{display:block;width:16px;height:16px;border-radius:8px;background:#fff;margin-left:2px;transition:margin-left .15s}',
  '.dpf-switch.on .knob{margin-left:22px}',
  '.dpf-input{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
  '.dpf-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
  '.dpf-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
  '.dpf-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
  '.dpf-actions{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dpf-save{height:36px;padding:0 14px;border:none;border-radius:18px;background:var(--dsw-alias-button-primary-fill);font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer}',
  '.dpf-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
  '.dpf-save:disabled{opacity:.5;cursor:default}',
  '.dpf-msg{margin:0;font-size:12px;line-height:1.5}',
  '.dpf-msg[data-ok=true]{color:var(--dsw-alias-state-success-primary)}',
  '.dpf-msg[data-ok=false]{color:var(--dsw-alias-state-error-primary)}',
].join('')

const STYLE_ID = '@max-null/dsh-draft-polish/settings.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-draft-polish'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** One stacked settings field (label + optional hint + control). */
function Field(props: { label: string; hint?: string; children?: ReactNode }): ReactNode {
  return createElement('div', { className: 'dpf-field' }, [
    createElement('span', { key: 'label', className: 'dpf-label' }, props.label),
    props.children,
    props.hint !== undefined
      ? createElement('p', { key: 'hint', className: 'dpf-hint' }, props.hint)
      : null,
  ])
}

/** The settings form component (state-loaded from the host config route). */
export function PolishSettings(): ReactNode {
  const t = langStrings()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [form, setForm] = useState<DraftPolishConfigView>({
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
  })

  useEffect(() => {
    let cancelled = false
    draftPolishApi.config()
      .then((config) => {
        if (!cancelled) {
          setForm(config)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMsg({ ok: false, text: t.setLoadFail })
          setLoaded(true)
        }
      })
    return () => { cancelled = true }
  }, [t])

  const update = useCallback((field: keyof DraftPolishConfigView, value: string | number | boolean): void => {
    setForm(prev => ({ ...prev, [field]: value }))
    setMsg(null)
  }, [])

  const handleSave = useCallback((): void => {
    if (saving) return
    setSaving(true)
    setMsg(null)
    draftPolishApi.configUpdate({
      provider: form.provider,
      model: form.model,
      temperature: Number(form.temperature),
      timeoutMs: Number(form.timeoutMs),
      contextEnabled: Boolean(form.contextEnabled),
      recentWindowMessages: Number(form.recentWindowMessages),
      backgroundEnabled: Boolean(form.backgroundEnabled),
      backgroundWindowMessages: Number(form.backgroundWindowMessages),
    })
      .then(() => { setMsg({ ok: true, text: t.setSaved }) })
      .catch((error: unknown) => {
        const message = error instanceof DraftPolishApiError
          ? error.message
          : error instanceof Error ? error.message : String(error)
        setMsg({ ok: false, text: t.setSaveFail + message })
      })
      .finally(() => { setSaving(false) })
  }, [saving, form, t])

  if (!loaded) return createElement('div', { className: 'dpf' })

  const numberInput = (
    field: keyof DraftPolishConfigView,
    min: number,
    max: number,
    step: number,
  ): ReactNode => createElement('input', {
    className: 'dpf-input',
    type: 'number',
    min,
    max,
    step,
    value: String(form[field]),
    onChange: (e: { target: { value: string } }) => { update(field, Number(e.target.value)) },
  })

  /** A checkbox row: label left, switch right (the native row posture). */
  const checkRow = (field: 'contextEnabled' | 'backgroundEnabled'): ReactNode =>
    createElement('div', { className: 'dpf-head' }, [
      createElement('span', { key: 'spacer', className: 'dpf-label' }, ''),
      createElement('button', {
        key: 'switch',
        className: `dpf-switch${form[field] ? ' on' : ''}`,
        type: 'button',
        'aria-label': field === 'contextEnabled' ? t.setContext : t.setBackground,
        onClick: () => { update(field, !form[field]) },
      }),
    ])

  return createElement('div', { className: 'dpf' }, [
    createElement('div', { key: 'head' }, [
      createElement('h3', { style: { margin: '0 0 4px', fontSize: 18, fontWeight: 600, lineHeight: '26px', color: 'var(--dsw-alias-label-primary)' } }, t.setTitle),
      createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } }, t.setSubtitle),
    ]),
    createElement(Field, { key: 'ctx', label: t.setContext, hint: t.setContextHint },
      checkRow('contextEnabled')),
    createElement(Field, { key: 'provider', label: t.setProvider, hint: t.setProviderHint },
      createElement('input', {
        className: 'dpf-input',
        type: 'text',
        value: form.provider,
        placeholder: t.setProviderHint,
        onChange: (e: { target: { value: string } }) => { update('provider', e.target.value) },
      })),
    createElement(Field, { key: 'model', label: t.setModel, hint: t.setModelHint },
      createElement('input', {
        className: 'dpf-input',
        type: 'text',
        value: form.model,
        onChange: (e: { target: { value: string } }) => { update('model', e.target.value) },
      })),
    createElement(Field, { key: 'recent', label: t.setRecent, hint: t.setRecentHint },
      numberInput('recentWindowMessages', 1, 32, 1)),
    createElement(Field, { key: 'bg', label: t.setBackground, hint: t.setBackgroundHint },
      checkRow('backgroundEnabled')),
    form.backgroundEnabled
      ? createElement(Field, { key: 'bgw', label: t.setBackgroundWindow },
        numberInput('backgroundWindowMessages', 1, 128, 1))
      : null,
    createElement(Field, { key: 'temp', label: t.setTemp, hint: t.setTempHint },
      numberInput('temperature', 0, 1, 0.05)),
    createElement(Field, { key: 'timeout', label: t.setTimeout },
      numberInput('timeoutMs', 5000, 120000, 1000)),
    createElement('div', { key: 'actions', className: 'dpf-actions' }, [
      createElement('button', {
        key: 'save',
        type: 'button',
        className: 'dpf-save',
        disabled: saving,
        onClick: handleSave,
      }, saving ? t.setSaving : t.setSave),
      msg !== null
        ? createElement('p', { key: 'msg', className: 'dpf-msg', 'data-ok': msg.ok ? 'true' : 'false' }, msg.text)
        : null,
    ]),
  ])
}
