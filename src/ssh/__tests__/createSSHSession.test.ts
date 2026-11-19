import { describe, expect, test } from 'bun:test'

import type { SDKMessage } from '../../entrypoints/sdk/coreTypes.js'
import {
  buildRemoteCliArgs,
  buildRemoteCommand,
  buildSshOptionArgs,
  createSubprocessTransport,
  parseSshHost,
  shellQuote,
} from '../createSSHSession.js'
import { StderrTail } from '../protocol.js'
import { createSSHSessionManager, type SSHSessionManagerOptions } from '../SSHSessionManager.js'

describe('shellQuote', () => {
  test('leaves safe tokens untouched', () => {
    expect(shellQuote('claude')).toBe('claude')
    expect(shellQuote('/usr/local/bin/claude')).toBe('/usr/local/bin/claude')
    expect(shellQuote('--input-format')).toBe('--input-format')
  })

  test('single-quotes values with spaces and escapes embedded quotes', () => {
    expect(shellQuote('my dir')).toBe("'my dir'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('parseSshHost', () => {
  test('splits user@host', () => {
    expect(parseSshHost('alice@example.com')).toEqual({ user: 'alice', hostname: 'example.com' })
  })

  test('accepts a bare host', () => {
    expect(parseSshHost('example.com')).toEqual({ hostname: 'example.com' })
  })
})

describe('buildRemoteCliArgs', () => {
  test('emits the stream-json SDK flags', () => {
    const args = buildRemoteCliArgs({
      permissionMode: undefined,
      dangerouslySkipPermissions: false,
      extraCliArgs: [],
    })
    expect(args).toEqual([
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
    ])
  })

  test('passes permission mode, or skip-permissions instead', () => {
    expect(
      buildRemoteCliArgs({ permissionMode: 'auto', dangerouslySkipPermissions: false, extraCliArgs: [] }),
    ).toContain('auto')
    expect(
      buildRemoteCliArgs({ permissionMode: 'auto', dangerouslySkipPermissions: true, extraCliArgs: [] }),
    ).not.toContain('--permission-mode')
  })

  test('appends forwarded resume/model args', () => {
    const args = buildRemoteCliArgs({
      permissionMode: undefined,
      dangerouslySkipPermissions: false,
      extraCliArgs: ['--resume', 'uuid-1', '--model', 'opus'],
    })
    expect(args.slice(-4)).toEqual(['--resume', 'uuid-1', '--model', 'opus'])
  })
})

describe('buildSshOptionArgs', () => {
  test('builds the reverse-tunnel options', () => {
    const args = buildSshOptionArgs({ remoteSocket: '/tmp/r.sock', localSocket: '/tmp/l.sock' })
    expect(args[0]).toBe('-T')
    const rIndex = args.indexOf('-R')
    expect(args[rIndex + 1]).toBe('/tmp/r.sock:/tmp/l.sock')
  })

  test('includes port and identity file when provided', () => {
    const args = buildSshOptionArgs({
      remoteSocket: '/tmp/r.sock',
      localSocket: '/tmp/l.sock',
      port: 2222,
      identityFile: '/home/me/.ssh/id_ed25519',
    })
    expect(args[args.indexOf('-p') + 1]).toBe('2222')
    expect(args[args.indexOf('-i') + 1]).toBe('/home/me/.ssh/id_ed25519')
  })
})

describe('buildRemoteCommand', () => {
  const base = {
    cwd: '/srv/app',
    claudePath: 'claude',
    args: ['--print', '--verbose'],
    remoteSocket: '/tmp/claude-ssh-abc.sock',
  }

  test('cds, strips inherited auth, and sets tunnel env', () => {
    const command = buildRemoteCommand({ ...base, oauthPlaceholder: true })
    expect(command).toContain('cd /srv/app &&')
    expect(command).toContain('exec env')
    expect(command).toContain('-u ANTHROPIC_AUTH_TOKEN')
    expect(command).toContain('-u ANTHROPIC_API_KEY')
    expect(command).toContain('ANTHROPIC_UNIX_SOCKET=/tmp/claude-ssh-abc.sock')
    expect(command).toContain('ANTHROPIC_BASE_URL=http://api.anthropic.com')
    expect(command).toContain('CLAUDE_CODE_OAUTH_TOKEN=ssh-proxy-placeholder')
    expect(command).toContain('claude --print --verbose')
  })

  test('uses an API-key placeholder for non-subscribers', () => {
    const command = buildRemoteCommand({ ...base, oauthPlaceholder: false })
    expect(command).toContain('ANTHROPIC_API_KEY=ssh-proxy-placeholder')
    expect(command).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=')
  })

  test('skips cd when no working directory is given', () => {
    const command = buildRemoteCommand({ ...base, cwd: undefined, oauthPlaceholder: false })
    expect(command.startsWith('exec env')).toBe(true)
  })
})

describe('createSubprocessTransport', () => {
  test('pipes NDJSON through a real child process', async () => {
    const script = `
      process.stdin.setEncoding('utf8')
      let buf = ''
      process.stdin.on('data', (chunk) => {
        buf += chunk
        let idx
        while ((idx = buf.indexOf('\\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          const msg = JSON.parse(line)
          process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', echo: msg.message.content }) + '\\n')
        }
      })
      process.stdin.on('end', () => process.exit(0))
    `
    const proc = Bun.spawn(['bun', '-e', script], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const tail = new StderrTail()
    const transport = createSubprocessTransport(proc, tail)

    const messages: SDKMessage[] = []
    const options: SSHSessionManagerOptions = {
      onMessage: (m) => messages.push(m),
      onPermissionRequest: () => {},
      onConnected: () => {},
      onReconnecting: () => {},
      onDisconnected: () => {},
      onError: () => {},
    }
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    expect(await manager.sendMessage('ping')).toBe(true)

    const deadline = Date.now() + 5000
    while (messages.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(messages).toHaveLength(1)
    expect((messages[0] as unknown as { echo: string }).echo).toBe('ping')

    manager.disconnect()
  })
})
