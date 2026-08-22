/**
 * Minimal JSON wire helpers for the /draft-polish/api route (same envelope
 * as dsh-sidebar-qa's wire.ts: `{ok: true, value} | {ok: false, error}`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** One structured API failure (code + message + HTTP status). */
export class DraftPolishError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Read and parse a JSON request body ('' on empty; throws on bad JSON). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new DraftPolishError('bad-json', 'request body is not valid JSON', 400)
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Write the success envelope `{ok: true, value}`. */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope `{ok: false, error: {code, message}}`. */
export function writeError(res: ServerResponse, error: unknown): void {
  const e = error instanceof DraftPolishError
    ? error
    : new DraftPolishError('internal', error instanceof Error ? error.message : String(error), 500)
  writeJson(res, e.status, { ok: false, error: { code: e.code, message: e.message } })
}

/** Require a non-empty string field from a payload record. */
export function requireString(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DraftPolishError('bad-request', `"${key}" must be a non-empty string`)
  }
  return value
}

/** Read one optional string field ('' when absent or not a string). */
export function optionalString(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' ? value : ''
}
