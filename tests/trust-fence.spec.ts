import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, isTrustedApiRequest } from '../src/trust-fence.ts'

function req(headers: Record<string, string | undefined>): { headers: Record<string, string | undefined> } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts localhost, [::1] and 127.* addresses', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.8.8.8')).toBe(true)
  })

  it('rejects non-loopback hostnames and malformed quads', () => {
    expect(isLoopbackHostname('dsh.internal')).toBe(false)
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
    expect(isLoopbackHostname('127.0.0.999')).toBe(false)
    expect(isLoopbackHostname('127.0.0')).toBe(false)
  })
})

describe('isTrustedApiRequest', () => {
  it('passes a loopback Host without browser markers', () => {
    expect(isTrustedApiRequest(req({ host: '127.0.0.1:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(req({ host: 'localhost:3080' }), [])).toBe(true)
  })

  it('passes a loopback Host with a same-origin Origin', () => {
    expect(isTrustedApiRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), [])).toBe(true)
  })

  it('refuses a cross-site browser marker', () => {
    expect(isTrustedApiRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  })

  it('refuses a foreign Origin', () => {
    expect(isTrustedApiRequest(req({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), [])).toBe(false)
  })

  it('refuses a missing Host', () => {
    expect(isTrustedApiRequest(req({}), [])).toBe(false)
  })

  it('passes a trusted non-loopback authority from the connection row', () => {
    expect(isTrustedApiRequest(req({ host: 'dsh.example' }), ['dsh.example'])).toBe(true)
  })

  it('refuses a non-loopback host outside trustedHosts', () => {
    expect(isTrustedApiRequest(req({ host: 'dsh.example' }), [])).toBe(false)
  })
})
