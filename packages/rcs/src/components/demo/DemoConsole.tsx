'use client'

import {
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CornerDownLeft,
  Cpu,
  Gauge,
  GitBranch,
  Loader2,
  Lock,
  LockOpen,
  Menu,
  Moon,
  PanelLeftClose,
  PanelRight,
  Plus,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useTheme } from '@/lib/theme'
import { cx } from '@/lib/utils'

import { STATUS_LABEL, type DemoEnvironment, type DemoSession, type Entry, type FleetSession, type Turn } from './types'
import { useLiveConsole } from './useLiveConsole'

import styles from './DemoConsole.module.css'

/* ------------------------------------------------------------------ */
/* Mock 数据                                                           */
/* ------------------------------------------------------------------ */

const DEMO = {
  auth: {
    title: '将认证模块迁移到 src/auth/next',
    status: 'running',
    updated: '刚刚',
    branch: 'main',
    elapsed: '00:42:18',
    tokens: 134_200,
    limit: 200_000,
    entries: [
      { kind: 'system', text: '环境已连接 · 网关 18 ms' },
      {
        kind: 'user',
        at: '09:41',
        text: '把 NextAuth 适配器移到 `src/auth/next` 下，并阻止 Bun 网关直接引用它。',
      },
      {
        kind: 'assistant',
        paragraphs: [
          '已完成。Next.js 适配器现在位于 `src/auth/next`，而运行时中立的底层原语保留在 `src/auth/*`。',
          '这条边界由两个 oxlint 覆写规则强制约束，任何误写的 `@/auth/next` 导入都会在进入网关进程之前就报错。',
        ],
      },
      {
        kind: 'tools',
        items: [
          { name: 'Read', detail: 'src/auth/next/index.ts', time: '0.1s', state: 'done' },
          { name: 'Grep', detail: '@/lib/auth', time: '0.2s', state: 'done' },
          { name: 'Edit', detail: '12 个文件', time: '0.4s', state: 'done' },
          { name: 'Bash', detail: 'bun run rcs:build', time: '3.1s', state: 'running' },
        ],
      },
      {
        kind: 'permission',
        title: '运行生产构建？',
        detail: '重新构建 standalone 的 Next 产物，并检查路由表。',
        command: 'bun run rcs:build',
      },
    ],
    tasks: [
      { label: '迁移适配器到 src/auth/next', done: true },
      { label: '更新 12 处引用', done: true },
      { label: '添加 lint 边界', done: true },
      { label: '生产构建校验', done: false, active: true },
    ],
  },
  offline: {
    title: '修复 iOS 上的 PWA 离线回退',
    status: 'idle',
    updated: '2 小时前',
    branch: 'fix/offline',
    elapsed: '05:12:04',
    tokens: 61_800,
    limit: 200_000,
    entries: [
      { kind: 'system', text: '环境已连接 · 5 小时前' },
      { kind: 'user', at: '07:18', text: '离线页面显示的是启动图，而不是中英双语文案。' },
      {
        kind: 'assistant',
        paragraphs: ['iOS 从 manifest 里恢复了启动图。现在回退逻辑经由 `serwist`，并把 `/~offline` 预缓存为 HTML。'],
      },
      {
        kind: 'tools',
        items: [
          { name: 'Read', detail: 'src/app/sw.ts', time: '0.1s', state: 'done' },
          { name: 'Edit', detail: 'src/app/sw.ts', time: '0.3s', state: 'done' },
        ],
      },
    ],
    tasks: [
      { label: '在 iOS 18 上复现', done: true },
      { label: '通过 serwist 处理回退', done: true },
      { label: '验证安装提示', done: true },
    ],
  },
  splash: {
    title: '将启动图管线迁移到 TypeScript',
    status: 'active',
    updated: '昨天',
    branch: 'feat/splash',
    elapsed: '00:18:52',
    tokens: 24_600,
    limit: 200_000,
    entries: [
      { kind: 'system', text: '环境已连接 · 22 小时前' },
      { kind: 'user', at: '16:02', text: '完成启动图资源管线，并保持品牌手册同步。' },
      {
        kind: 'assistant',
        paragraphs: ['生成器从单个源 SVG 产出所有 `apple-touch-startup-image` 尺寸，输出位于 `public/icons/splash`。'],
      },
      {
        kind: 'tools',
        items: [
          { name: 'Write', detail: 'scripts/brand/splash.ts', time: '0.2s', state: 'done' },
          { name: 'Bash', detail: 'node scripts/brand/splash.ts', time: '1.4s', state: 'done' },
        ],
      },
    ],
    tasks: [
      { label: '生成亮/暗色两套', done: true },
      { label: '输出 iOS 尺寸矩阵', done: true },
      { label: '更新品牌手册', done: true },
    ],
  },
} satisfies Record<string, DemoSession>

const ENVIRONMENTS: readonly DemoEnvironment[] = [
  { id: 'env-mbp', name: 'MacBook Pro', host: 'apple-silicon', status: 'online' },
  { id: 'env-studio', name: 'Studio', host: 'linux', status: 'idle' },
]

const INITIAL_SESSIONS: FleetSession[] = [
  { ...DEMO.auth, id: 'auth', environmentId: 'env-mbp' },
  { ...DEMO.offline, id: 'offline', environmentId: 'env-mbp' },
  { ...DEMO.splash, id: 'splash', environmentId: 'env-studio' },
]

const MODELS = ['Opus 4.6', 'Sonnet 4.6', 'Haiku 4.5'] as const
const PERMISSIONS = ['询问', '自动', '计划'] as const
const THINKING = ['标准', '扩展', '关闭'] as const

const QUEUED_REPLY = '已排入下一轮——CLI 会在不打断你正在查看的这次运行的情况下把它并入。'

/** 实时数据加载中或没有可展示的会话时的占位。 */
const EMPTY_SESSION: FleetSession = {
  id: '',
  environmentId: null,
  title: '等待会话',
  status: 'idle',
  updated: '—',
  branch: '—',
  elapsed: '—',
  tokens: 0,
  limit: 200_000,
  entries: [],
  tasks: [],
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function cycle<T>(options: readonly [T, ...T[]], current: T): T {
  const index = options.indexOf(current)
  return options[(index + 1) % options.length] ?? current
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/** 网关 id 很长（`session_…`）；让面包屑保持可读。 */
function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

function renderInline(text: string): ReactNode[] {
  return text.split(/`([^`]+)`/g).map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className={styles.inlineCode}>
        {part}
      </code>
    ) : (
      part
    ),
  )
}

function delayFor(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, 8) * 55}ms` }
}

/** 品牌标记：提示符箭头、三个提交点，以及远程火花。 */
function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={styles.brandSvg}>
      <rect width="64" height="64" rx="15" fill="var(--color-brand)" />
      <path
        d="M16 19.5 L27.5 32 L16 44.5"
        fill="none"
        stroke="#f6f5f2"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="44.5" r="3" fill="#f6f5f2" />
      <circle cx="40.5" cy="44.5" r="3" fill="#f6f5f2" />
      <circle cx="49" cy="44.5" r="3" fill="#f6f5f2" />
      <path
        d="M48.5 18.1 Q49.908 23.092 54.9 24.5 Q49.908 25.908 48.5 30.9 Q47.092 25.908 42.1 24.5 Q47.092 23.092 48.5 18.1 Z"
        fill="#f6f5f2"
      />
    </svg>
  )
}

export type DemoSource = 'live' | 'mock'

export function DemoConsole({ source = 'live' }: { source?: DemoSource }) {
  const isLive = source === 'live'
  const live = useLiveConsole(isLive)
  const { resolvedTheme, setTheme } = useTheme()

  // Mock 设计研究状态 —— 仅在 `?source=mock` 时使用。
  const [mockSessions, setMockSessions] = useState(INITIAL_SESSIONS)
  const [mockActiveId, setMockActiveId] = useState('auth')
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<(typeof MODELS)[number]>('Opus 4.6')
  const [permission, setPermission] = useState<(typeof PERMISSIONS)[number]>('询问')
  const [thinking, setThinking] = useState<(typeof THINKING)[number]>('标准')
  const [railOpen, setRailOpen] = useState(false)
  const [desktopRailOpen, setDesktopRailOpen] = useState(true)
  const [desktopLedgerOpen, setDesktopLedgerOpen] = useState(true)
  const [mobileLedgerOpen, setMobileLedgerOpen] = useState(false)
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({})
  const [answers, setAnswers] = useState<Record<string, 'approved' | 'denied'>>({})
  const [turns, setTurns] = useState<Record<string, Turn[]>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createEnv, setCreateEnv] = useState('')
  // 实时模式初始为只读；接管后会放开发送、审批和新建会话。
  // `?source=mock` 完全忽略这一点。
  const [takeover, setTakeover] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const sessions = isLive ? live.sessions : mockSessions
  const environments: readonly DemoEnvironment[] = isLive ? live.environments : ENVIRONMENTS
  const activeId = isLive ? (live.activeId ?? '') : mockActiveId
  const mockSession = mockSessions.find((item) => item.id === mockActiveId) ?? INITIAL_SESSIONS[0]
  const liveSession = live.active
  const session: FleetSession = (isLive ? liveSession : mockSession) ?? EMPTY_SESSION
  const extraTurns = isLive ? [] : (turns[mockActiveId] ?? [])
  const isPending = isLive ? Boolean(liveSession?.turnOpen || liveSession?.streaming) : Boolean(pending[mockActiveId])
  const closed = isLive && (liveSession?.closed ?? false)
  const signedOut = isLive && live.signedOut
  const canWrite = isLive ? takeover && session.id !== '' && !closed : true
  const environmentName = environments.find((env) => env.id === session.environmentId)?.name ?? '未分配'
  const envGroups = [
    ...environments.map((env) => ({
      id: env.id,
      name: env.name,
      host: env.host,
      status: env.status,
      items: sessions.filter((item) => item.environmentId === env.id),
    })),
    {
      id: 'unassigned',
      name: '未分配',
      host: '未关联',
      status: 'idle' as const,
      items: sessions.filter((item) => item.environmentId === null),
    },
  ].filter((group) => group.items.length > 0)
  const usagePercent = Math.min(100, Math.round((session.tokens / session.limit) * 100))
  const userTurnCount =
    session.entries.filter((entry) => entry.kind === 'user').length +
    extraTurns.filter((turn) => turn.role === 'user').length

  const linkLabel = !isLive
    ? '网关已连接'
    : signedOut
      ? '未登录'
      : live.connection === 'connected'
        ? '网关已连接'
        : live.connection === 'error'
          ? '网关连接失败'
          : '连接中…'
  const linkLatency = isLive ? (live.latencyMs !== null ? `${live.latencyMs} ms` : '—') : '18 ms'

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeId, session.entries.length, extraTurns.length, isPending])

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      for (const timer of activeTimers) clearTimeout(timer)
      activeTimers.clear()
    }
  }, [])

  function selectSession(id: string): void {
    if (isLive) live.setActiveId(id)
    else setMockActiveId(id)
    setRailOpen(false)
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text) return

    if (isLive) {
      if (!canWrite) return
      setActionError(null)
      setDraft('')
      try {
        await live.send(text)
      } catch (error) {
        // 恢复草稿，便于重试失败的发送。
        setDraft(text)
        setActionError(error instanceof Error ? error.message : String(error))
      }
      return
    }

    if (isPending) return
    const sessionId = mockActiveId
    setDraft('')
    setTurns((prev) => ({ ...prev, [sessionId]: [...(prev[sessionId] ?? []), { role: 'user', text }] }))
    setPending((prev) => ({ ...prev, [sessionId]: true }))

    const timer = setTimeout(() => {
      setTurns((prev) => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] ?? []), { role: 'assistant', text: QUEUED_REPLY }],
      }))
      setPending((prev) => ({ ...prev, [sessionId]: false }))
      timers.current.delete(timer)
    }, 1200)
    timers.current.add(timer)
  }

  function answerPermission(key: string, requestId: string | undefined, approved: boolean): void {
    if (isLive) {
      if (!canWrite || requestId === undefined) return
      const answer = approved ? 'approved' : 'denied'
      setActionError(null)
      setAnswers((prev) => ({ ...prev, [key]: answer }))
      void live.respondPermission(requestId, approved).catch((error: unknown) => {
        setAnswers((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setActionError(error instanceof Error ? error.message : String(error))
      })
      return
    }
    setAnswers((prev) => ({ ...prev, [key]: approved ? 'approved' : 'denied' }))
  }

  async function handleCreateSession(): Promise<void> {
    const title = createTitle.trim()
    if (isLive) {
      if (!takeover || !createEnv) return
      setActionError(null)
      try {
        await live.createSession({ title: title || undefined, environmentId: createEnv })
        setCreateOpen(false)
        setCreateTitle('')
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      }
      return
    }

    const environment = ENVIRONMENTS.find((env) => env.id === createEnv) ?? ENVIRONMENTS[0]
    const id = `web-${Date.now()}`
    const created: FleetSession = {
      id,
      environmentId: environment.id,
      title: title || '未命名会话',
      status: 'idle',
      updated: '刚刚',
      branch: 'web',
      elapsed: '00:00:00',
      tokens: 0,
      limit: 200_000,
      entries: [{ kind: 'system', text: `已派发到 ${environment.name}，等待工作进程认领…` }],
      tasks: [],
    }
    setMockSessions((prev) => [created, ...prev])
    setMockActiveId(id)
    setCreateOpen(false)
    setCreateTitle('')
    setCreateEnv('')
  }

  function openCreate(): void {
    setCreateOpen(true)
    if (!environments.some((env) => env.id === createEnv)) setCreateEnv(environments[0]?.id ?? '')
  }

  function closeCreate(): void {
    setCreateOpen(false)
    setCreateTitle('')
    setCreateEnv('')
  }

  function toggleLedger(): void {
    setDesktopLedgerOpen((open) => !open)
    setMobileLedgerOpen((open) => !open)
  }

  // 侧栏在桌面端是固定列，低于 55rem 时是覆盖抽屉。
  // 重新打开时同时设置两个标志，让头部按钮在两种布局下都可用。
  function openRail(): void {
    setDesktopRailOpen(true)
    setRailOpen(true)
  }

  function closePanels(): void {
    setRailOpen(false)
    setMobileLedgerOpen(false)
  }

  function renderEntry(entry: Entry, index: number): ReactNode {
    const entryKey = `${activeId}-entry-${index}`

    switch (entry.kind) {
      case 'system':
        return (
          <div key={entryKey} className={cx(styles.entry, styles.system)} style={delayFor(index)}>
            {entry.text}
          </div>
        )

      case 'user':
        return (
          <div key={entryKey} className={cx(styles.entry, styles.user)} style={delayFor(index)}>
            <div className={styles.userLabel}>
              <span>你</span>
              <span className={styles.timestamp}>{entry.at}</span>
            </div>
            <p className={styles.userText}>{renderInline(entry.text)}</p>
          </div>
        )

      case 'assistant':
        return (
          <div key={entryKey} className={cx(styles.entry, styles.assistant)} style={delayFor(index)}>
            <span className={styles.assistantAvatar} aria-hidden="true">
              S
            </span>
            <div className={styles.assistantBody}>
              {entry.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex}>{renderInline(paragraph)}</p>
              ))}
            </div>
          </div>
        )

      case 'tools': {
        const toolsKey = `${activeId}-tools-${index}`
        const open = openTools[toolsKey] ?? index === 3
        return (
          <div key={entryKey} className={cx(styles.entry, styles.tools)} style={delayFor(index)}>
            <button
              type="button"
              className={styles.toolsHead}
              aria-expanded={open}
              onClick={() => setOpenTools((prev) => ({ ...prev, [toolsKey]: !open }))}
            >
              {open ? (
                <ChevronDown className={styles.toolIcon} aria-hidden="true" />
              ) : (
                <ChevronRight className={styles.toolIcon} aria-hidden="true" />
              )}
              <Terminal className={styles.toolIcon} aria-hidden="true" />
              <span className={styles.toolsLabel}>工具调用</span>
              <span className={styles.toolsCount}>{entry.items.length} 步</span>
            </button>
            {open ? (
              <div className={styles.toolRows}>
                {entry.items.map((item, itemIndex) => (
                  <div key={itemIndex} className={styles.toolRow}>
                    <span className={styles.toolState} data-state={item.state}>
                      {item.state === 'running' ? (
                        <Loader2 className={styles.spin} aria-label="运行中" />
                      ) : item.state === 'error' ? (
                        <Circle aria-label="失败" />
                      ) : (
                        <CircleCheck aria-label="已完成" />
                      )}
                    </span>
                    <span className={styles.toolName}>{item.name}</span>
                    <span className={styles.toolDetail}>{item.detail}</span>
                    <span className={styles.toolTime}>{item.time}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      }

      case 'permission': {
        // 实时卡片以网关请求 id 作为 key；mock 卡片回退到位置。
        const permissionKey = entry.requestId ?? `${activeId}-permission-${index}`
        const answer = answers[permissionKey]
        return (
          <div key={entryKey} className={cx(styles.entry, styles.permission)} style={delayFor(index)}>
            <div className={styles.permissionHead}>
              <ShieldCheck className={styles.permissionIcon} aria-hidden="true" />
              <div>
                <p className={styles.permissionTitle}>{entry.title}</p>
                <p className={styles.permissionDetail}>{entry.detail}</p>
              </div>
            </div>
            <pre className={styles.permissionCommand}>
              <code>{entry.command}</code>
            </pre>
            {answer ? (
              <p className={styles.permissionAnswer} data-answer={answer}>
                {answer === 'approved' ? '已批准——已发送到环境。' : '已拒绝——智能体稍后会再次询问。'}
              </p>
            ) : canWrite ? (
              <div className={styles.permissionActions}>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => answerPermission(permissionKey, entry.requestId, true)}
                >
                  批准
                </button>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => answerPermission(permissionKey, entry.requestId, false)}
                >
                  拒绝
                </button>
              </div>
            ) : (
              <p className={styles.permissionAnswer} data-answer="denied">
                只读预览——接管后可审批。
              </p>
            )}
          </div>
        )
      }

      default: {
        const exhaustive: never = entry
        return exhaustive
      }
    }
  }

  function renderTurn(turn: Turn, index: number): ReactNode {
    const turnKey = `${activeId}-turn-${index}`
    if (turn.role === 'user') {
      return (
        <div key={turnKey} className={cx(styles.entry, styles.user)} style={delayFor(index)}>
          <div className={styles.userLabel}>
            <span>你</span>
            <span className={styles.timestamp}>刚刚</span>
          </div>
          <p className={styles.userText}>{renderInline(turn.text)}</p>
        </div>
      )
    }
    return (
      <div key={turnKey} className={cx(styles.entry, styles.assistant)} style={delayFor(index)}>
        <span className={styles.assistantAvatar} aria-hidden="true">
          S
        </span>
        <div className={styles.assistantBody}>
          <p>{renderInline(turn.text)}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cx(
        styles.root,
        !desktopRailOpen && styles.railCollapsed,
        !desktopLedgerOpen && styles.ledgerCollapsed,
      )}
    >
      <button
        type="button"
        className={cx(styles.scrim, (railOpen || mobileLedgerOpen) && styles.scrimOpen)}
        onClick={closePanels}
        aria-label="关闭面板"
      />

      <aside className={cx(styles.rail, railOpen && styles.railOpen)} aria-label="会话列表">
        <div className={styles.brand}>
          <BrandMark />
          <div className={styles.brandText}>
            <p className={styles.brandName}>Sobird</p>
            <p className={styles.brandSub}>远程控制台</p>
          </div>
          <button
            type="button"
            className={styles.railCollapseBtn}
            onClick={() => setDesktopRailOpen(false)}
            aria-label="收起会话列表"
          >
            <PanelLeftClose className={styles.icon} />
          </button>
          <button
            type="button"
            className={styles.railClose}
            onClick={() => setRailOpen(false)}
            aria-label="关闭会话列表"
          >
            <X className={styles.icon} />
          </button>
        </div>

        <div className={styles.railBody}>
          <div className={styles.railHeadRow}>
            <p className={styles.eyebrow}>01 — 会话</p>
            <button type="button" className={styles.newSessionBtn} onClick={openCreate}>
              <Plus className={styles.icon} aria-hidden="true" />
              新建
            </button>
          </div>
          {envGroups.map((group) => (
            <section key={group.id} className={styles.env}>
              <div className={styles.envHead}>
                <span className={styles.statusDot} data-status={group.status} />
                <span className={styles.envName}>{group.name}</span>
                <span className={styles.envHost}>{group.host}</span>
              </div>
              <div className={styles.sessionList}>
                {group.items.map((item) => {
                  const isActive = item.id === activeId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.sessionButton}
                      aria-current={isActive}
                      onClick={() => selectSession(item.id)}
                    >
                      <span className={styles.sessionTop}>
                        <span className={styles.statusDot} data-status={item.status} />
                        <span className={styles.sessionTitle}>{item.title}</span>
                      </span>
                      <span className={styles.sessionMeta}>
                        <span>{item.updated}</span>
                        <span className={styles.metaDot} aria-hidden="true">
                          ·
                        </span>
                        <span>{item.branch}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className={styles.railFoot}>
          <div className={styles.linkState}>
            <span className={styles.pulseDot} aria-hidden="true" />
            <span>{linkLabel}</span>
            <span className={styles.linkLatency}>{linkLatency}</span>
          </div>
          <div className={styles.railFootRow}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={`切换到${resolvedTheme === 'dark' ? '浅色' : '深色'}主题`}
            >
              {resolvedTheme === 'dark' ? <Moon className={styles.icon} /> : <Sun className={styles.icon} />}
            </button>
            <span className={styles.demoTag}>{isLive ? '实时' : '设计研究'}</span>
            <span className={styles.avatar} aria-hidden="true">
              S
            </span>
          </div>
        </footer>
      </aside>

      <aside className={styles.railCompact} aria-label="会话列表">
        <button
          type="button"
          className={styles.railCompactBrand}
          onClick={openRail}
          aria-label="展开会话列表"
          title="展开会话列表"
        >
          <BrandMark />
        </button>
        <button
          type="button"
          className={styles.railCompactAction}
          onClick={openCreate}
          aria-label="新建会话"
          title="新建会话"
        >
          <Plus className={styles.icon} />
        </button>
        <div className={styles.railCompactDots}>
          {envGroups.map((group) => (
            <span
              key={group.id}
              className={styles.railCompactDot}
              title={`${group.name} · ${group.host}`}
              role="img"
              aria-label={`${group.name}：${
                group.status === 'online' ? '在线' : group.status === 'offline' ? '离线' : '空闲'
              }`}
            >
              <span className={styles.statusDot} data-status={group.status} />
            </span>
          ))}
        </div>
        <div className={styles.railCompactFoot}>
          <span className={styles.pulseDot} role="img" aria-label="网关已连接" />
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={`切换到${resolvedTheme === 'dark' ? '浅色' : '深色'}主题`}
          >
            {resolvedTheme === 'dark' ? <Moon className={styles.icon} /> : <Sun className={styles.icon} />}
          </button>
        </div>
      </aside>

      <main className={styles.stage}>
        <header className={styles.stageHead}>
          <div className={styles.headLead}>
            <button type="button" className={styles.fleetButton} onClick={openRail} aria-label="打开会话列表">
              <Menu className={styles.icon} />
            </button>
            <span className={styles.crumbId}>会话 / {activeId ? (isLive ? shortId(activeId) : activeId) : '—'}</span>
            <h1 className={styles.title}>{session.title}</h1>
            <div className={styles.crumbMeta}>
              <GitBranch className={styles.metaIcon} aria-hidden="true" />
              <span className={styles.mono}>{session.branch}</span>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.mono}>{session.updated}</span>
            </div>
          </div>

          <div className={styles.headTools}>
            <button
              type="button"
              className={styles.chip}
              title="切换模型"
              onClick={() => setModel(cycle(MODELS, model))}
            >
              <Cpu className={styles.chipIcon} aria-hidden="true" />
              <span className={styles.chipLabel}>{model}</span>
              <ChevronDown className={styles.chipChevron} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.chip}
              title="切换推理强度"
              onClick={() => setThinking(cycle(THINKING, thinking))}
            >
              <Brain className={styles.chipIcon} aria-hidden="true" />
              <span className={styles.chipLabel}>{thinking}</span>
              <ChevronDown className={styles.chipChevron} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.chip}
              title="切换权限模式"
              onClick={() => setPermission(cycle(PERMISSIONS, permission))}
            >
              <ShieldCheck className={styles.chipIcon} aria-hidden="true" />
              <span className={styles.chipLabel}>{permission}</span>
              <ChevronDown className={styles.chipChevron} aria-hidden="true" />
            </button>
            {isLive ? (
              <button
                type="button"
                className={cx(styles.chip, takeover && styles.chipActive)}
                onClick={() => setTakeover((value) => !value)}
                disabled={!live.authenticated}
                title={takeover ? '已接管：发送与审批会写入网关' : '接管后可发送消息和审批权限'}
              >
                {takeover ? (
                  <LockOpen className={styles.chipIcon} aria-hidden="true" />
                ) : (
                  <Lock className={styles.chipIcon} aria-hidden="true" />
                )}
                <span className={styles.chipLabel}>{takeover ? '已接管' : '接管'}</span>
              </button>
            ) : null}
            <span className={styles.statusPill} data-status={session.status}>
              <span className={styles.statusDot} data-status={session.status} />
              <span className={styles.statusLabel}>{STATUS_LABEL[session.status]}</span>
            </span>
            <button type="button" className={styles.iconBtn} onClick={toggleLedger} aria-label="切换上下文面板">
              <PanelRight className={styles.icon} />
            </button>
          </div>
        </header>

        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.thread}>
            {signedOut ? (
              <div className={styles.notice}>
                实时模式需要登录才能读取网关数据。
                <a className={styles.noticeLink} href="/login?next=/demo">
                  前往登录 →
                </a>
              </div>
            ) : null}
            {isLive && live.error ? <div className={cx(styles.notice, styles.noticeError)}>{live.error}</div> : null}
            {actionError ? <div className={cx(styles.notice, styles.noticeError)}>{actionError}</div> : null}
            {isLive && !signedOut && !live.loading && sessions.length === 0 ? (
              <div className={styles.notice}>还没有会话——点击左侧“新建”在已连接的环境上启动一个。</div>
            ) : null}
            {session.entries.map((entry, index) => renderEntry(entry, index))}
            {extraTurns.map((turn, index) => renderTurn(turn, session.entries.length + index))}
            {isPending ? (
              <div className={cx(styles.entry, styles.thinking)} role="status">
                <span className={styles.pulseDot} aria-hidden="true" />
                <span>智能体处理中</span>
                <span className={styles.thinkingDots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.composerWrap}>
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
          >
            <div className={styles.composerRow}>
              <span className={styles.promptGlyph} aria-hidden="true">
                ❯
              </span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
                rows={1}
                aria-label="给智能体发消息"
                disabled={isLive && (!canWrite || signedOut)}
                placeholder={
                  signedOut
                    ? '未登录——先登录再发送'
                    : closed
                      ? '会话已关闭'
                      : isLive && !takeover
                        ? '只读预览——点“接管”后可发送'
                        : isPending
                          ? '智能体处理中——发送后续消息会排队'
                          : '给智能体发消息…'
                }
                className={styles.textarea}
              />
            </div>
            <div className={styles.composerBar}>
              <span className={styles.keyHint}>
                {isLive && (!takeover || signedOut) ? (
                  <>{signedOut ? '未登录' : '只读预览 · 接管后可发送'}</>
                ) : (
                  <>
                    <CornerDownLeft className={styles.keyHintIcon} aria-hidden="true" />
                    Enter 发送 · Shift+Enter 换行
                  </>
                )}
              </span>
              <button
                type="submit"
                className={styles.sendButton}
                disabled={!draft.trim() || (isLive && (!canWrite || signedOut))}
                aria-label="发送消息"
              >
                <ArrowUp className={styles.sendIcon} />
              </button>
            </div>
          </form>
        </div>
      </main>

      <aside className={cx(styles.ledger, mobileLedgerOpen && styles.ledgerOpen)} aria-label="运行信息">
        <div className={styles.ledgerHead}>
          <span className={styles.eyebrow}>02 — 运行信息</span>
          <button
            type="button"
            className={styles.ledgerClose}
            onClick={() => setMobileLedgerOpen(false)}
            aria-label="关闭上下文面板"
          >
            <X className={styles.icon} />
          </button>
        </div>

        <section className={styles.ledgerSection}>
          <h2 className={styles.ledgerLabel}>运行状态</h2>
          <div className={styles.stateCard}>
            <div className={styles.stateTop}>
              <span className={styles.statusDot} data-status={session.status} />
              {STATUS_LABEL[session.status]}
            </div>
            <div className={styles.stateGrid}>
              <div className={styles.stateCell}>
                <span className={styles.metaKey}>已用时长</span>
                <span className={styles.metaVal}>{session.elapsed}</span>
              </div>
              <div className={styles.stateCell}>
                <span className={styles.metaKey}>环境</span>
                <span className={styles.metaVal}>{environmentName}</span>
              </div>
              <div className={styles.stateCell}>
                <span className={styles.metaKey}>模型</span>
                <span className={styles.metaVal}>{model}</span>
              </div>
              <div className={styles.stateCell}>
                <span className={styles.metaKey}>思考</span>
                <span className={styles.metaVal}>{thinking}</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.ledgerSection}>
          <h2 className={styles.ledgerLabel}>上下文窗口</h2>
          <div className={styles.usageRow}>
            <span className={styles.usageValue}>{formatTokens(session.tokens)}</span>
            <span className={styles.usageLimit}>/ {formatTokens(session.limit)}</span>
          </div>
          <div className={styles.meter} role="img" aria-label={`已使用 ${usagePercent}% 上下文`}>
            <span className={styles.meterFill} style={{ width: `${usagePercent}%` }} />
          </div>
          <div className={styles.usageFoot}>
            <Gauge className={styles.usageIcon} aria-hidden="true" />
            已用 {usagePercent}% · {userTurnCount} 轮
          </div>
        </section>

        <section className={styles.ledgerSection}>
          <h2 className={styles.ledgerLabel}>任务</h2>
          <ul className={styles.tasks}>
            {session.tasks.map((task) => (
              <li key={task.label} className={cx(styles.task, task.done && styles.taskDone)}>
                {task.done ? (
                  <CircleCheck className={styles.taskIcon} aria-hidden="true" />
                ) : task.active ? (
                  <Loader2 className={cx(styles.taskIcon, styles.spin)} aria-label="进行中" />
                ) : (
                  <Circle className={styles.taskIcon} aria-hidden="true" />
                )}
                <span>{task.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className={styles.ledgerNote}>
          {isLive
            ? takeover
              ? '实时数据 · 已接管，发送与审批会写入网关。'
              : '实时数据 · 只读预览。点上方“接管”后可发送与审批。'
            : '设计研究 · 仅演示数据。不会发送到网关。'}
        </p>
      </aside>

      {createOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeCreate()
          }}
        >
          <form
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-session-title"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreateSession()
            }}
          >
            <h2 id="new-session-title" className={styles.modalTitle}>
              新建会话
            </h2>
            <p className={styles.modalDesc}>在已连接的环境上启动会话。</p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>标题（可选）</span>
              <input
                className={styles.textInput}
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="我的会话"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>环境</span>
              <select
                className={styles.selectInput}
                value={createEnv}
                onChange={(event) => setCreateEnv(event.target.value)}
              >
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>

            {isLive && !takeover ? <p className={styles.modalDesc}>只读模式下无法创建会话——先点“接管”。</p> : null}

            <div className={styles.modalActions}>
              <button type="button" className={styles.btnGhost} onClick={closeCreate}>
                取消
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={isLive && (!takeover || !createEnv)}>
                创建会话
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
