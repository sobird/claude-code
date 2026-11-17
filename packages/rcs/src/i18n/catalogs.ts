// src/i18n/catalogs.ts
import en from '../../messages/en.json'
import zhCN from '../../messages/zh-CN.json'
import type { Locale } from './locales'

export type Messages = typeof en

export const CATALOGS: Record<Locale, Messages> = { en, 'zh-CN': zhCN }

export function loadMessages(locale: Locale): Messages {
  return CATALOGS[locale]
}
