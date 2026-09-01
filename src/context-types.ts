/**
 * Structural types for the cordis services this plugin consumes (host half).
 * A third-party plugin resolves outside the DSH monorepo's single cordis
 * instance, so the upstream `declare module 'cordis'` augmentations do not
 * reach this Context — the members below mirror the actual runtime shapes
 * this plugin touches (same pattern as dsh-sidebar-qa's context-types):
 *
 * - webServer (@deepseek-ai/dsh-host-webserver)
 * - sessionQuery (@deepseek-ai/dsh-session-query)
 * - llm (@deepseek-ai/dsh-llm)
 * - loader (@cordisjs/plugin-loader)
 * - settings (@deepseek-ai/dsh-settings)
 *
 * Drift from upstream is contained to this file. Only the leaf fields the
 * plugin reads are declared; live cordis objects are never serialized.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface DraftPolishWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface DraftPolishWebServer {
  register(route: DraftPolishWebRoute): () => void
}

/** Minimal structural mirror of one session surface event (readSurface output). */
export interface DraftPolishSurfaceEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One atomic live-preferred observation of a session's current model surface. */
export interface DraftPolishSurfaceSnapshot {
  session: unknown
  /** Highest raw-log seq included in the observation, or null for an empty log. */
  capturedThroughSeq: number | null
  events: DraftPolishSurfaceEvent[]
}

/** The sessionQuery service face (only readSurface is needed). */
export interface DraftPolishSessionQueryService {
  readSurface(sessionId: string): Promise<DraftPolishSurfaceSnapshot>
}

/** One message passed to the llm service (structural Message mirror). */
export interface DraftPolishLlmMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: readonly { type: 'text'; text: string }[]
  source: { kind: string; plugin?: string }
}

/** One model request, fully assembled (structural GenerateOptions mirror). */
export interface DraftPolishLlmRequest {
  provider: string
  model: string
  messages: DraftPolishLlmMessage[]
  system?: string
  maxTokens?: number
  reasoningEffort?: string
  signal?: AbortSignal
}

/** One raw streaming chunk emitted by the adapter (structural StreamChunk mirror). */
export type DraftPolishStreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; text?: string } }
  | { type: 'usage'; usage: unknown }
  | { type: 'finish'; reason: { kind?: string } }

/** The llm service face this plugin uses (stream a one-shot polish call). */
export interface DraftPolishLlmService {
  stream(options: DraftPolishLlmRequest): AsyncIterable<DraftPolishStreamChunk>
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface DraftPolishLoaderEntry {
  options: { name: string; config?: { trustedHosts?: string[] } }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface DraftPolishLoader {
  entries(): Iterable<DraftPolishLoaderEntry>
}

/** The settings namespace scope this plugin reads. */
export interface DraftPolishSettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void): () => void
  /** Merge a partial patch into this namespace's user layer (no revision guard). */
  update(patch: object): Promise<void>
}

/** One current selection emitted by the agent-default-model service. */
export interface DraftPolishDefaultSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The agent-default-model service face (DSH 默认渠道，会话创建时应用). */
export interface DraftPolishAgentDefaultModel {
  currentSelection(): DraftPolishDefaultSelection
}

/** One registered namespace descriptor surfaced to configuration surfaces. */
export interface DraftPolishSettingsDescriptor {
  ns: string
  value?: unknown
  revision: number
}

/** The settings service face (register + revision-guarded update + describe). */
export interface DraftPolishSettingsService {
  register<T>(ns: string, schema: unknown, options?: object): DraftPolishSettingsScope<T>
  describe(options?: { redactSecrets?: boolean }): DraftPolishSettingsDescriptor[]
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: DraftPolishWebServer
    sessionQuery: DraftPolishSessionQueryService
    llm: DraftPolishLlmService
    loader: DraftPolishLoader
    settings: DraftPolishSettingsService
    agentDefaultModel: DraftPolishAgentDefaultModel
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
