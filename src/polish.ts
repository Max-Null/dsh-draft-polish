/**
 * The polish prompt family: the system directive and the user-message
 * assembly that wraps the optional conversation context and the draft.
 *
 * The system prompt inherits the battle-tested skeleton from fractal's
 * `buildPolishPrompt` (v1.1 direct-DeepSeek revision): a Chinese writing
 * assistant that outputs ONLY the polished message — any explanation would
 * pollute the composer — and never re-quotes the context block.
 */

/** Input cap inherited from fractal (4000 chars ≈ 1.5 万 token 的上限的一半量级). */
export const POLISH_INPUT_MAX_CHARS = 4000

/** The system directive: direct output, fidelity first, keep code/links verbatim. */
export const POLISH_SYSTEM = [
  '你是一位中文写作助手，擅长把用户组织得不够通顺的草稿润色成清晰、准确、得体的消息。',
  '输出要求：',
  '1. 只输出润色后的消息本身，不要任何解释、前缀、引号或客套话。',
  '2. 忠实于草稿原意：不增删事实、不改变立场与语气，只修通顺度、清晰度和得体度。',
  '3. 代码、链接、文件路径、命令、专有名词保持原样，不做任何改写。',
  '4. 不显著拉长原文；如果草稿本身简洁，保持简洁。',
  '5. 根据草稿形态微调：明确的指令任务保持结构化（任务/要求/输出）；提问改为清晰完整的问句；普通文本修顺表达。',
].join('\n')

/** The background-context compression directive (only used when backgroundEnabled). */
export const BACKGROUND_SYSTEM = [
  '你是对话上下文压缩助手。下面是主对话【较早部分】的原文，按时间从新到旧排列（第一条是最新状态，每条以「用户：」或「助手：」开头）。',
  '请用最多 3 句话概括，依次是：会话目标（在做什么）、当前进度（最新状态/最近完成了什么）、未决事项（没有就省略这一句）。',
  '要求：极简、只陈述事实、禁止列清单、禁止复述指令、禁止编造；早期指令若已被后续执行，视为已完成，不要当作未决事项。',
].join('\n')

/**
 * Assemble the user message for one polish call: the optional context block
 * first (explicitly background-only), then the draft itself — the draft sits
 * last because that is the model's strongest attention position.
 * @param context - the composed context block ('' when no context).
 * @param draft - the raw draft text (trimmed, non-empty, already capped).
 */
export function buildPolishPrompt(context: string, draft: string): string {
  const parts: string[] = []
  if (context.trim() !== '') {
    parts.push(
      '下面是当前会话的部分上下文，仅作背景理解，帮助你明白草稿在讨论什么；',
      '不要引用上下文里的内容到润色结果中，不要复述它。',
      '',
      context.trim(),
    )
  }
  parts.push('待润色草稿：', draft)
  return parts.join('\n')
}
