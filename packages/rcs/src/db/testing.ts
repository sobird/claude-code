/**
 * 测试用共享 PGlite 数据库。
 *
 * Bun 的测试运行器在同一进程内跨测试文件共享模块缓存，所以这里用模块级单例：
 * 第一个调用方付一次建库 + 迁移（约 1.5s），后续文件复用同一实例。测试之间靠
 * `resetTestDatabase()`（TRUNCATE … RESTART IDENTITY CASCADE，约 15ms）隔离，
 * 而不是每次重建数据库。实例不主动 close：任意文件的 afterAll 关闭都会让后续文件失效，
 * 进程退出时由运行时回收。
 *
 * 外键保持生产语义（不做关闭）。需要合法 owner 引用的用例用
 * `createTestRepositories({ seedUsers: true })` 播种 `TEST_USER_IDS` 对应的 fixture 用户；
 * 其余用例保持空库，避免 fixture 影响 `users.count()/list()` 之类的断言。
 */

import { sql } from 'drizzle-orm'

import { createPgliteDatabase, runMigrations } from '@/db/client'
import { createRepositories } from '@/db/repositories'
import type { Repositories } from '@/db/repositories/types'
import { users } from '@/db/schema'

type TestDatabase = Awaited<ReturnType<typeof createPgliteDatabase>>['db']

/** 固定的合法 uuid，供需要在测试里引用 owner 的场景替代任意字符串。 */
export const TEST_USER_IDS = {
  user1: '00000000-0000-4000-8000-000000000001',
  user2: '00000000-0000-4000-8000-000000000002',
  alice: '00000000-0000-4000-8000-000000000003',
  bob: '00000000-0000-4000-8000-000000000004',
} as const

let database: Promise<TestDatabase> | null = null

/** 进程级、已迁移的 PGlite 实例；首次调用建库并跑迁移，之后直接返回。 */
export function getTestDatabase(): Promise<TestDatabase> {
  database ??= (async () => {
    const ctx = await createPgliteDatabase()
    await runMigrations(ctx.db)
    return ctx.db
  })()
  return database
}

const LIST_PUBLIC_TABLES = sql`select tablename from pg_tables where schemaname = 'public'`

/** 清空全部应用表；drizzle 的迁移记录在独立 schema，不受影响。 */
export async function resetTestDatabase(db?: TestDatabase): Promise<void> {
  const target = db ?? (await getTestDatabase())
  const result = await target.execute(LIST_PUBLIC_TABLES)
  const tables = result.rows.map((row) => row.tablename).filter((name): name is string => typeof name === 'string')
  if (tables.length === 0) return
  const list = tables.map((name) => `"${name}"`).join(', ')
  await target.execute(sql.raw(`truncate table ${list} restart identity cascade`))
}

const SEED_USERS = [
  { id: TEST_USER_IDS.user1, username: 'test-user-1' },
  { id: TEST_USER_IDS.user2, username: 'test-user-2' },
  { id: TEST_USER_IDS.alice, username: 'test-alice' },
  { id: TEST_USER_IDS.bob, username: 'test-bob' },
]

async function seedTestUsers(db: TestDatabase): Promise<void> {
  const values: (typeof users.$inferInsert)[] = SEED_USERS.map((user) => ({
    ...user,
    passwordHash: 'x',
    role: 'member',
  }))
  await db.insert(users).values(values)
}

export interface CreateTestRepositoriesOptions {
  /** 播种 `TEST_USER_IDS` 的 fixture 用户，让 owner 外键有对应的 user 行。 */
  seedUsers?: boolean
}

/** 清空共享测试库后返回仓库包；每个测试前调用即得到隔离的初始状态。 */
export async function createTestRepositories(options: CreateTestRepositoriesOptions = {}): Promise<Repositories> {
  const db = await getTestDatabase()
  await resetTestDatabase(db)
  if (options.seedUsers) await seedTestUsers(db)
  return createRepositories(db)
}
