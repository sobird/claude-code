/**
 * Bootstrap administrator provisioning.
 *
 * On an empty user table, create `ADMIN_USERNAME` (lowercased) with the
 * password from `ADMIN_PASSWORD` as an admin. The check is `users.count() === 0`
 * so an existing deployment is never touched. Missing env values are skipped
 * with a warning — never invent credentials.
 *
 * This module is DB-driver agnostic (takes a `Repositories`), so it stays
 * importable under `bun test` with the in-memory repository.
 */

import { hashPassword } from '@/auth/password'
import type { Repositories } from '@/db/repositories/types'

export const BOOTSTRAP_ADMIN_DISPLAY_NAME = 'Administrator'

export async function ensureBootstrapAdmin(repos: Repositories): Promise<void> {
  const count = await repos.users.count()
  if (count > 0) return

  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!username || !password) {
    console.warn('[rcs] ADMIN_USERNAME/ADMIN_PASSWORD not set; skipping bootstrap admin provisioning')
    return
  }

  const passwordHash = await hashPassword(password)
  await repos.users.create({
    username,
    displayName: BOOTSTRAP_ADMIN_DISPLAY_NAME,
    passwordHash,
    role: 'admin',
  })
  console.info(`[rcs] provisioned bootstrap admin "${username}"`)
}
