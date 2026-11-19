/**
 * `claude ssh` session factories.
 *
 * `createSSHSession` probes a remote host, (optionally) deploys the bundled
 * binary, then runs `claude --print --input-format stream-json` over ssh with
 * a `-R` unix-socket forward to a local auth proxy (`sshAuthProxy.ts`).
 *
 * `createLocalSSHSession` is the `--local` path: it spawns the current CLI
 * directly with the same stream-json protocol and tunnel env, so the proxy and
 * permission plumbing can be exercised without a remote host.
 */

import { randomUUID } from 'node:crypto'

import type { Subprocess } from 'bun'

import { isClaudeAISubscriber } from '../utils/auth.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import { buildCliLaunch } from '../utils/cliLaunch.js'
import { logForDebugging } from '../utils/debug.js'
import { LineDecoder, StderrTail } from './protocol.js'
import { createAuthProxy, type SSHAuthProxyHandle } from './sshAuthProxy.js'
import {
  createSSHSessionManager,
  type ManagerTransport,
  type SSHSessionManager,
  type SSHSessionManagerOptions,
} from './SSHSessionManager.js'

export interface SSHAuthProxy {
  stop(): void
}

export interface SSHSession {
  remoteCwd: string
  proc: Subprocess
  proxy: SSHAuthProxy
  createManager(options: SSHSessionManagerOptions): SSHSessionManager
  getStderrTail(): string
}

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

const AUTH_PLACEHOLDER = 'ssh-proxy-placeholder'
const TUNNEL_BASE_URL = 'http://api.anthropic.com'
const MAX_RECONNECT = 3

/** Variables that would route the child away from the tunnel. */
const STRIPPED_CHILD_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_PROVIDER',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
]

/** POSIX single-quote escaping; safe tokens pass through untouched. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function parseSshHost(host: string): { user?: string; hostname: string } {
  const at = host.lastIndexOf('@')
  if (at === -1) return { hostname: host }
  return { user: host.slice(0, at), hostname: host.slice(at + 1) }
}

export interface RemoteCliArgOptions {
  permissionMode?: string
  dangerouslySkipPermissions: boolean
  extraCliArgs: string[]
}

/** Flags for the remote CLI: SDK stream-json mode with host-mediated permissions. */
export function buildRemoteCliArgs(options: RemoteCliArgOptions): string[] {
  const args = [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-prompt-tool',
    'stdio',
  ]
  if (options.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')
  else if (options.permissionMode) args.push('--permission-mode', options.permissionMode)
  args.push(...options.extraCliArgs)
  return args
}

export interface SshOptionArgsOptions {
  remoteSocket: string
  localSocket: string
  port?: number
  identityFile?: string
}

/** ssh options (host and command are appended by the caller). */
export function buildSshOptionArgs(options: SshOptionArgsOptions): string[] {
  const args = ['-T', '-o', 'BatchMode=yes']
  if (options.port) args.push('-p', String(options.port))
  if (options.identityFile) args.push('-i', options.identityFile)
  args.push('-R', `${options.remoteSocket}:${options.localSocket}`)
  return args
}

export interface RemoteCommandOptions {
  cwd?: string
  claudePath: string
  args: string[]
  remoteSocket: string
  oauthPlaceholder: boolean
}

/**
 * The `bash -lc` payload run on the remote: cd, launch through the tunnel, and
 * clear any inherited auth so the proxy is the sole credential source.
 */
export function buildRemoteCommand(options: RemoteCommandOptions): string {
  const prefix = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : ''
  const envParts = [
    'env',
    '-u',
    'ANTHROPIC_AUTH_TOKEN',
    '-u',
    'ANTHROPIC_API_KEY',
    '-u',
    'ANTHROPIC_BASE_URL',
    '-u',
    'CLAUDE_CODE_OAUTH_TOKEN',
    `ANTHROPIC_UNIX_SOCKET=${shellQuote(options.remoteSocket)}`,
    `ANTHROPIC_BASE_URL=${shellQuote(TUNNEL_BASE_URL)}`,
  ]
  if (options.oauthPlaceholder) {
    envParts.push(`CLAUDE_CODE_OAUTH_TOKEN=${shellQuote(AUTH_PLACEHOLDER)}`)
  } else {
    envParts.push(`ANTHROPIC_API_KEY=${shellQuote(AUTH_PLACEHOLDER)}`)
  }
  const command = options.args.map(shellQuote).join(' ')
  return `${prefix}exec ${envParts.join(' ')} ${shellQuote(options.claudePath)}${command ? ` ${command}` : ''}`
}

/**
 * Wrap a piped child process in the manager's transport interface. The reader
 * starts on the first `onLine` subscription so no early output is dropped.
 */
export function createSubprocessTransport(proc: Subprocess, stderrTail: StderrTail): ManagerTransport {
  let lineHandler: ((line: string) => void) | undefined
  let exitHandler: ((info: { code: number | null; signal: string | null }) => void) | undefined
  let exitInfo: { code: number | null; signal: string | null } | undefined
  let started = false

  const startStdout = () => {
    if (!proc.stdout || typeof proc.stdout === 'number') return
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    const lines = new LineDecoder()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const line of lines.push(decoder.decode(value, { stream: true }))) lineHandler?.(line)
        }
        const remainder = lines.flush()
        if (remainder) lineHandler?.(remainder)
      } catch (error) {
        logForDebugging(`[SSHSession] stdout read failed: ${String(error)}`)
      }
    })()
  }

  const startStderr = () => {
    if (!proc.stderr || typeof proc.stderr === 'number') return
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          stderrTail.push(decoder.decode(value, { stream: true }))
        }
      } catch {
        // stderr is diagnostic only; never let it tear down the session.
      }
    })()
  }

  void proc.exited.then((code) => {
    exitInfo = { code, signal: proc.signalCode ?? null }
    exitHandler?.(exitInfo)
    return code
  })

  return {
    write(chunk: string): void {
      const stdin = proc.stdin
      if (!stdin || typeof stdin === 'number') throw new Error('SSH child stdin is not a pipe')
      void stdin.write(chunk)
      void stdin.flush()
    },
    onLine(cb: (line: string) => void): void {
      lineHandler = cb
      if (started) return
      started = true
      startStdout()
      startStderr()
    },
    onExit(cb: (info: { code: number | null; signal: string | null }) => void): void {
      exitHandler = cb
      if (exitInfo) cb(exitInfo)
    },
    kill(): void {
      try {
        proc.kill()
      } catch (error) {
        logForDebugging(`[SSHSession] kill failed: ${String(error)}`)
      }
    },
  }
}

function buildTunnelEnv(socketPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const key of STRIPPED_CHILD_ENV) delete env[key]
  env.ANTHROPIC_UNIX_SOCKET = socketPath
  env.ANTHROPIC_BASE_URL = TUNNEL_BASE_URL
  if (isClaudeAISubscriber()) env.CLAUDE_CODE_OAUTH_TOKEN = AUTH_PLACEHOLDER
  else env.ANTHROPIC_API_KEY = AUTH_PLACEHOLDER
  return env
}

function assembleSession(
  proc: Subprocess,
  proxy: SSHAuthProxyHandle,
  remoteCwd: string,
  stderrTail: StderrTail,
  respawn?: () => Subprocess,
): SSHSession {
  return {
    remoteCwd,
    proc,
    proxy,
    getStderrTail: () => stderrTail.get(),
    createManager(options: SSHSessionManagerOptions): SSHSessionManager {
      const transport = createSubprocessTransport(proc, stderrTail)
      if (!respawn) return createSSHSessionManager(transport, options)
      return createSSHSessionManager(transport, options, {
        maxReconnect: MAX_RECONNECT,
        respawn: () => createSubprocessTransport(respawn(), stderrTail),
      })
    },
  }
}

export interface LocalSSHSessionOptions {
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
}

/** `--local`: spawn this CLI with the stream-json tunnel protocol, no ssh. */
export function createLocalSSHSession(options: LocalSSHSessionOptions = {}): SSHSession {
  if (typeof Bun === 'undefined') {
    throw new SSHSessionError('SSH sessions require the Bun runtime')
  }

  const proxy = createAuthProxy()
  const stderrTail = new StderrTail()
  const remoteCwd = options.cwd ?? process.cwd()

  try {
    const args = buildRemoteCliArgs({
      permissionMode: options.permissionMode,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
      extraCliArgs: [],
    })
    const launch = buildCliLaunch(args)
    const proc = Bun.spawn([launch.command, ...launch.args], {
      cwd: remoteCwd,
      env: buildTunnelEnv(proxy.socketPath),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return assembleSession(proc, proxy, remoteCwd, stderrTail)
  } catch (error) {
    proxy.stop()
    throw new SSHSessionError(`Failed to start local session: ${messageOf(error)}`)
  }
}

export interface CreateSSHSessionOptions {
  host: string
  cwd?: string
  localVersion: string
  permissionMode?: string
  dangerouslySkipPermissions: boolean
  extraCliArgs: string[]
}

export interface CreateSSHSessionCallbacks {
  onProgress?: (message: string) => void
}

async function capture(argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

const PROBE_SCRIPT =
  'p=$(command -v claude 2>/dev/null); if [ -n "$p" ]; then echo "$p"; "$p" --version 2>/dev/null; fi'

async function probeRemoteClaude(
  host: string,
  sshOptions: string[],
  localVersion: string,
  onProgress: (message: string) => void,
): Promise<string> {
  onProgress('Probing remote…')
  const { stdout } = await capture(['ssh', ...sshOptions, host, 'bash', '-lc', PROBE_SCRIPT])
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const path = lines[0]
  if (path) {
    const version = lines[1]
    if (version && version !== localVersion) {
      onProgress(`Remote claude ${version} (local ${localVersion})`)
    }
    return path
  }

  if (!isInBundledMode()) {
    throw new SSHSessionError(
      `claude was not found on ${host}. Install it there, or run this from a bundled build to deploy automatically.`,
    )
  }

  onProgress('Deploying claude…')
  const remotePath = `/tmp/claude-ssh-${randomUUID()}`
  const deploy = Bun.spawn(
    [
      'ssh',
      ...sshOptions,
      host,
      'bash',
      '-lc',
      `cat > ${shellQuote(remotePath)} && chmod +x ${shellQuote(remotePath)}`,
    ],
    {
      stdin: Bun.file(process.execPath),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const deployCode = await deploy.exited
  if (deployCode !== 0) {
    const stderr = await new Response(deploy.stderr).text()
    throw new SSHSessionError(`Failed to deploy claude to ${host}: ${stderr.trim() || `exit ${deployCode}`}`)
  }
  return remotePath
}

export async function createSSHSession(
  options: CreateSSHSessionOptions,
  callbacks: CreateSSHSessionCallbacks = {},
): Promise<SSHSession> {
  if (typeof Bun === 'undefined') {
    throw new SSHSessionError('SSH sessions require the Bun runtime')
  }

  const onProgress = callbacks.onProgress ?? (() => {})
  const proxy = createAuthProxy()
  const stderrTail = new StderrTail()

  try {
    const remoteSocket = `/tmp/claude-ssh-${randomUUID()}.sock`
    const sshOptions = buildSshOptionArgs({ remoteSocket, localSocket: proxy.socketPath })
    const claudePath = await probeRemoteClaude(options.host, sshOptions, options.localVersion, onProgress)

    const args = buildRemoteCliArgs({
      permissionMode: options.permissionMode,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      extraCliArgs: options.extraCliArgs,
    })
    const remoteCommand = buildRemoteCommand({
      cwd: options.cwd,
      claudePath,
      args,
      remoteSocket,
      oauthPlaceholder: isClaudeAISubscriber(),
    })
    const argv = ['ssh', ...sshOptions, options.host, 'bash', '-lc', remoteCommand]

    onProgress('Connecting…')
    const proc = Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    return assembleSession(proc, proxy, options.cwd ?? '.', stderrTail, () =>
      Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }),
    )
  } catch (error) {
    proxy.stop()
    if (error instanceof SSHSessionError) throw error
    throw new SSHSessionError(`SSH session to ${options.host} failed: ${messageOf(error)}`)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
