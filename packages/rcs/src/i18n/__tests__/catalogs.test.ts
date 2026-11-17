// src/i18n/__tests__/catalogs.test.ts
import { describe, expect, test } from 'bun:test'

import { CATALOGS } from '../catalogs'
import { KNOWN_ERROR_CODES } from '../error-codes'

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      for (const [k, v] of flatten(child, path)) out.set(k, v)
    }
  } else if (typeof value === 'string') {
    out.set(prefix, value)
  }
  return out
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{\s*(\w+)/g)].map((match) => match[1] ?? '').sort()

describe('message catalogs', () => {
  test('zh-CN and en expose the same key set', () => {
    expect([...flatten(CATALOGS['zh-CN']).keys()].toSorted()).toEqual([...flatten(CATALOGS.en).keys()].toSorted())
  })

  test('each translation uses the same ICU placeholders', () => {
    const en = flatten(CATALOGS.en)
    const zh = flatten(CATALOGS['zh-CN'])
    for (const [key, text] of en) {
      expect({ key, placeholders: placeholders(zh.get(key) ?? '') }).toEqual({ key, placeholders: placeholders(text) })
    }
  })

  test('every known server code has copy in both catalogs', () => {
    for (const code of KNOWN_ERROR_CODES) {
      expect(typeof (CATALOGS.en.errors.codes as Record<string, string>)[code]).toBe('string')
      expect(typeof (CATALOGS['zh-CN'].errors.codes as Record<string, string>)[code]).toBe('string')
    }
  })
})
