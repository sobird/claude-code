import { stripTrailingSlash } from './util'

/** 子进程启动方式：dsh 已装成命令时用 DSH_BIN，否则用 DSH_REPO 从源码跑。 */
export interface DshLaunchConfig {
  command: string
  args: string[]
  cwd: string
}

export interface BridgeConfig {
  /** RCS 网关根地址（默认 http://localhost:4000）。 */
  rcsBaseUrl: string
  /** 创建会话与换取 worker 凭据用的用户 API key。 */
  apiKey: string
  /** dsh 会话的工作目录，同时也是 workspace-write 的边界。 */
  workdir: string
  title: string | undefined
  provider: string
  model: string
  dsh: DshLaunchConfig
}

function envText(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? ''
}

/** 读取环境变量；缺少必需项时直接报错，不做隐式默认。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const apiKey = envText(env, 'RCS_API_KEY')
  if (!apiKey) throw new Error('RCS_API_KEY is required (a user API key that can create sessions)')

  const workdir = envText(env, 'DSH_WORKDIR') || process.cwd()
  const dshRepo = envText(env, 'DSH_REPO')
  const dsh: DshLaunchConfig = dshRepo
    ? {
        // dsh 的原生插件需要 V8 context，Bun 不满足（node-addon-require-builtin），
        // 因此从源码跑时必须用 Node，而不是桥自身的 process.execPath。
        command: envText(env, 'NODE_BIN') || 'node',
        args: ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'sdk'],
        cwd: dshRepo,
      }
    : {
        command: envText(env, 'DSH_BIN') || 'dsh',
        args: ['--profile', 'sdk'],
        cwd: workdir,
      }

  return {
    rcsBaseUrl: stripTrailingSlash(envText(env, 'RCS_BASE_URL') || 'http://localhost:4000'),
    apiKey,
    workdir,
    title: envText(env, 'RCS_SESSION_TITLE') || undefined,
    provider: envText(env, 'DSH_PROVIDER') || 'deepseek-official',
    model: envText(env, 'DSH_MODEL') || 'deepseek-v4-flash',
    dsh,
  }
}
