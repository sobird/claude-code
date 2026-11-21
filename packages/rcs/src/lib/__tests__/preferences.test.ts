import { describe, expect, test } from 'bun:test'

import { createMemoryRepositories } from '@/db/repositories'
import { parseLocalePreference, setUserLocale } from '@/lib/preferences'

describe('parseLocalePreference', () => {
  test('accepts only supported locales', () => {
    expect(parseLocalePreference({ locale: 'en' })).toBe('en')
    expect(parseLocalePreference({ locale: 'zh-CN' })).toBe('zh-CN')
    expect(parseLocalePreference({ locale: 'fr' })).toBeNull()
    expect(parseLocalePreference({})).toBeNull()
    expect(parseLocalePreference(null)).toBeNull()
    expect(parseLocalePreference('en')).toBeNull()
  })
})

describe('setUserLocale', () => {
  test('persists a valid locale and rejects an invalid one', async () => {
    const repos = createMemoryRepositories()
    const user = await repos.users.create({ username: 'pref-user', passwordHash: 'x', role: 'member' })

    expect(await setUserLocale(repos, user.id, { locale: 'en' })).toEqual({ ok: true, locale: 'en' })
    expect((await repos.users.getById(user.id))?.locale).toBe('en')

    expect(await setUserLocale(repos, user.id, { locale: 'fr' })).toEqual({ ok: false, code: 'invalid_locale' })
    expect((await repos.users.getById(user.id))?.locale).toBe('en')
  })
})
