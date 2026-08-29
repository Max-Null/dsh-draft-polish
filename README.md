# @max-null/dsh-draft-polish

本插件属于 **`@max-null/*` 插件系列**——这一系列共同构成 **[SSID（思灵 · Seek Soul in Darkness）](https://github.com/Max-Null/seek-soul-in-darkness)** 桌面体验。SSID 是整合它们的盒：`dsh-capture` · `dsh-chat-rail` · `dsh-chinese-thinking` · `dsh-draft-polish` · `dsh-guardian` · `dsh-habit` · `dsh-memory` · `dsh-node-appearance` · `dsh-plugin-center` · `dsh-quick-toolbar` · `dsh-skill-mcp-center` · `dsh-ssid-panels` · `dsh-ssid-zh-ui` · `dsh-achievements`。

This plugin belongs to the **`@max-null/*` family** — a set of plugins that together form the **[SSID (思灵 · Seek Soul in Darkness)](https://github.com/Max-Null/seek-soul-in-darkness)** desktop experience.

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**草稿润色**插件：发送按钮左侧的 ✨ 按钮，一键调用 LLM 把你写得不那么通顺的草稿改得更清晰、更得体，结果直接回填输入框，满意后再发送。

> 从 **分形（OC 桌面壳）** 迁移进化的功能：OC 环境受 serve 并发缺陷限制，会话正在输出时无法润色；DSH 的 `llm` 能力与会话调度完全解耦，**会话进行中也能润色**，且可携带**当前会话上下文**帮助模型理解你的意图（参考 dsh-sidebar-qa 的提问带上下文机制）。

## 截图

（待补充：发送按钮左侧 ✨ 按钮 + 润色效果）

## 特性

| 能力 | 说明 |
|---|---|
| **一键润色** | 发送按钮左侧 ✨，点击后 LLM 润色草稿，结果回填输入框 |
| **会话进行中可用** | 走 DSH `llm` 渠道，与 agent 会话调度解耦——正在输出时照常润色（OC 时代的痛点） |
| **携带会话上下文** | 默认把最近 4 条对话作为背景上下文带给模型，帮助理解意图；可关闭 |
| **复用现有模型渠道** | 不需要单独配 API Key，默认继承当前会话渠道；也可单独指定 provider/model |
| **零污染** | 润色不创建会话、不写入历史，只改输入框草稿 |
| **按会话隔离** | 每个会话的输入框独立，润色期间切换会话，结果仍写回发起会话 |

## 安装

```bash
dsh plugin --profile <name> add @max-null/dsh-draft-polish
```

或手动加入 profile 的 `package.json` dependencies + `dsh.profile.bundles`：

```yaml
- id: draft-polish
  name: '@max-null/dsh-draft-polish'
```

## 使用

1. 在输入框里写草稿；
2. 点发送按钮左侧的 ✨ 按钮（输入为空时按钮不触发）；
3. 等待数秒，润色结果自动替换输入框内容（按钮转圈表示润色中）；
4. 检查结果，满意后照常发送。

### 设置

设置页 →「润色设置」（或配置命名空间 `draft-polish`）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `provider` | '' | 润色模型渠道；留空继承当前会话渠道 |
| `model` | `deepseek-v4-flash` | 润色模型 |
| `reasoningEffort` | `off` | 思考强度（润色用 off 最快） |
| `budgetTokens` | 1024 | 输出 token 预算 |
| `temperature` | 0.3 | 低随机性保原意 |
| `timeoutMs` | 30000 | 超时兜底 |
| `contextEnabled` | true | 是否携带会话上下文 |
| `recentWindowMessages` | 4 | 近期对话条数（原文保留，每段 ≤400 字符） |
| `backgroundEnabled` | false | 是否压缩更早背景（多一次快速模型调用） |
| `backgroundWindowMessages` | 12 | 背景窗口条数 |
| `backgroundBudgetTokens` | 160 | 背景摘要输出预算 |

## 架构

- **host 半端**（`lib/index.js`）：`/draft-polish/api` 路由（trust fence 同 /api 网关）——`sessionQuery.readSurface` 读会话上下文 → `llm.stream` 润色（复用 DSH 渠道，独立于会话调度）→ 回传文本；`draft-polish` settings 命名空间。
- **client 半端**（`lib/client.js`）：`conversation.input.right` 槽（发送按钮左侧官方座位）注入 ✨ 按钮——读草稿（owner props）→ fetch host → 结果经标准 kit `inputActions.setDraft` 写回；`settings.section` 注册设置表单。
- 上下文策略继承 dsh-sidebar-qa：近期对话原文截断（锚定最新状态）+ 更早背景可选压缩（≤3 句摘要），从新到旧排列；任何失败降级为不带上下文，润色不中断。

## 与 OC 版（分形）的差异

| | 分形（OC） | dsh-draft-polish（DSH） |
|---|---|---|
| LLM 通道 | 主进程直连 DeepSeek API（自管 key，受控例外） | `ctx.llm` 复用 DSH 渠道（零凭证） |
| 会话进行中 | v1.1 直连后才可用 | 天然可用 |
| 上下文 | 不带历史（v1.2 决策） | 默认带近期上下文（可关） |
| 草稿隔离 | 自建 useSessionDrafts 协调 | input machine 每会话独立，平台保证 |

## 开发

```bash
pnpm install
pnpm typecheck   # tsc 严格类型检查
pnpm test        # vitest（host 纯函数 + 组件）
pnpm build       # 产出 lib/
```

## SSID 系列

## License

MIT
