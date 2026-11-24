import { asText, isRecord, stripTrailingSlash } from '@sobird/dsh-bridge/core'

/** `single` 接一条 RCS 会话；`environment` 注册成本机环境，接 RCS 派发的多条会话。 */
export type BridgeMode = 'single' | 'environment'

/** 解析后的插件配置；`sessionId` 用于复用既有 RCS 会话。 */
export interface ResolvedConfig {
  rcsBaseUrl: string
  apiKey: string
  workdir: string
  sessionTitle: string | undefined
  provider: string
  model: string
  sessionId: string | undefined
  mode: BridgeMode
  environmentId: string | undefined
  /** 存活的桥上限，同时也是注册时的 `max_sessions`。 */
  maxSessions: number
}

const DEFAULT_MAX_SESSIONS = 4

function configText(config: Record<string, unknown>, key: string): string {
  return asText(config[key]).trim()
}

/** 只读的环境快照；不绑定宿主 `ProcessEnv` 的增强类型，便于单测传普通对象。 */
type EnvLike = Record<string, string | undefined>

function envText(env: EnvLike, key: string): string {
  return env[key]?.trim() ?? ''
}

/** 字段级优先级：config 覆盖同名环境变量，再回落到默认值。 */
function pick(config: Record<string, unknown>, env: EnvLike, configKey: string, envKey: string, fallback = ''): string {
  return configText(config, configKey) || envText(env, envKey) || fallback
}

function parseMode(value: string): BridgeMode {
  const mode = value || 'single'
  if (mode !== 'single' && mode !== 'environment') {
    throw new Error(`rcs-bridge: invalid mode "${mode}" (expected "single" or "environment")`)
  }
  return mode
}

/** config 里的数字优先于环境变量字符串；`undefined` 走默认值。 */
function parseMaxSessions(value: string | number | undefined): number {
  if (value === undefined || value === '') return DEFAULT_MAX_SESSIONS
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`rcs-bridge: maxSessions must be a positive integer, got "${String(value)}"`)
  }
  return parsed
}

function configNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 连接三要素里的两项：去哪、用哪把 key（可能还没有）。 */
export interface ConnectionConfig {
  rcsBaseUrl: string
  apiKey: string | undefined
}

/**
 * 只解析「服务器地址 + 显式 key」，不关心是否已配对。
 *
 * 启动时先跑它：没有显式 key 就先走设备码配对，再把拿到的 key 交给 `resolveConfig`。
 */
export function resolveConnection(input: unknown, env: EnvLike = process.env): ConnectionConfig {
  const config = isRecord(input) ? input : {}
  const apiKey = pick(config, env, 'apiKey', 'RCS_API_KEY')
  return {
    rcsBaseUrl: stripTrailingSlash(pick(config, env, 'rcsBaseUrl', 'RCS_BASE_URL') || 'http://localhost:4000'),
    apiKey: apiKey || undefined,
  }
}

/** 已配对的凭据（由设备码流程写入）；优先级低于显式 config/env。 */
export interface CredentialSource {
  apiKey: string
}

/** 读取插件配置与环境变量；缺少 API key 时直接报错，不做隐式默认。 */
export function resolveConfig(
  input: unknown,
  env: EnvLike = process.env,
  credentials?: CredentialSource,
): ResolvedConfig {
  const config = isRecord(input) ? input : {}
  const connection = resolveConnection(config, env)
  const apiKey = connection.apiKey || credentials?.apiKey
  if (!apiKey) {
    throw new Error(
      'rcs-bridge: RCS_API_KEY is required (or set config.apiKey, or run /rcs-login to pair this machine)',
    )
  }

  return {
    rcsBaseUrl: connection.rcsBaseUrl,
    apiKey,
    workdir: pick(config, env, 'workdir', 'DSH_WORKDIR') || process.cwd(),
    sessionTitle: pick(config, env, 'sessionTitle', 'RCS_SESSION_TITLE') || undefined,
    provider: pick(config, env, 'provider', 'DSH_PROVIDER') || 'deepseek-official',
    model: pick(config, env, 'model', 'DSH_MODEL') || 'deepseek-v4-flash',
    sessionId: pick(config, env, 'sessionId', 'RCS_SESSION_ID') || undefined,
    mode: parseMode(pick(config, env, 'mode', 'RCS_BRIDGE_MODE')),
    environmentId: pick(config, env, 'environmentId', 'RCS_ENVIRONMENT_ID') || undefined,
    maxSessions: parseMaxSessions(
      configNumber(config, 'maxSessions') ?? pick(config, env, 'maxSessions', 'RCS_MAX_SESSIONS'),
    ),
  }
}
