import { describe, expect, it } from 'vitest'
import { buildPolishPrompt, POLISH_INPUT_MAX_CHARS, POLISH_SYSTEM } from '../src/polish.ts'

describe('POLISH_SYSTEM', () => {
  it('demands direct output without explanation', () => {
    expect(POLISH_SYSTEM).toContain('只输出润色后的消息本身')
    expect(POLISH_SYSTEM).toContain('不要任何解释')
  })

  it('keeps code, links and proper nouns verbatim', () => {
    expect(POLISH_SYSTEM).toContain('代码、链接、文件路径、命令、专有名词保持原样')
  })
})

describe('buildPolishPrompt', () => {
  it('places the draft alone without context', () => {
    const prompt = buildPolishPrompt('', '帮我看看这个报错')
    expect(prompt).toBe('待润色草稿：\n帮我看看这个报错')
  })

  it('prefixes the context block and marks it background-only', () => {
    const prompt = buildPolishPrompt('【近期对话】\n用户：在修登录报错', '帮我看看这个报错')
    expect(prompt).toContain('【近期对话】')
    expect(prompt).toContain('仅作背景理解')
    expect(prompt).toContain('不要引用上下文里的内容到润色结果中')
    // the draft still sits after the context
    expect(prompt.indexOf('待润色草稿')).toBeGreaterThan(prompt.indexOf('【近期对话】'))
  })

  it('omits the context block when it is whitespace', () => {
    const prompt = buildPolishPrompt('   ', '草稿')
    expect(prompt).not.toContain('背景理解')
    expect(prompt).toBe('待润色草稿：\n草稿')
  })
})

describe('POLISH_INPUT_MAX_CHARS', () => {
  it('is a positive bound', () => {
    expect(POLISH_INPUT_MAX_CHARS).toBeGreaterThan(0)
  })
})
