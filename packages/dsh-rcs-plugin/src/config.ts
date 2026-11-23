import { asText, isRecord, stripTrailingSlash } from '@sobird/dsh-bridge/core'

/** 解析后的插件配置；`sessionId` 用于复用既有 RCS 会话。 */
export interface ResolvedConfig {
  rcsBaseUrl: string
  apiKey: string
  workdir: string
  sessionTitle: string | undefined
  provider: string
  model: string
  sessionId: string | undefined
}

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

/** 读取插件配置与环境变量；缺少 API key 时直接报错，不做隐式默认。 */
export function resolveConfig(input: unknown, env: EnvLike = process.env): ResolvedConfig {
  const config = isRecord(input) ? input : {}
  const apiKey = pick(config, env, 'apiKey', 'RCS_API_KEY')
  if (!apiKey) {
    throw new Error('rcs-bridge: RCS_API_KEY is required (or set config.apiKey to a user API key)')
  }

  return {
    rcsBaseUrl: stripTrailingSlash(pick(config, env, 'rcsBaseUrl', 'RCS_BASE_URL') || 'http://localhost:4000'),
    apiKey,
    workdir: pick(config, env, 'workdir', 'DSH_WORKDIR') || process.cwd(),
    sessionTitle: pick(config, env, 'sessionTitle', 'RCS_SESSION_TITLE') || undefined,
    provider: pick(config, env, 'provider', 'DSH_PROVIDER') || 'deepseek-official',
    model: pick(config, env, 'model', 'DSH_MODEL') || 'deepseek-v4-flash',
    sessionId: pick(config, env, 'sessionId', 'RCS_SESSION_ID') || undefined,
  }
}
