// src/i18n/catalogs.ts
import type { MessageKeys, NestedKeyOf } from 'use-intl/core'

import en from '../../messages/en.json'
import zhCN from '../../messages/zh-CN.json'
import type { Locale } from './locales'

export type Messages = typeof en

/** Every fully-qualified leaf key in the catalog, as accepted by the root translator. */
export type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>

export const CATALOGS: Record<Locale, Messages> = { en, 'zh-CN': zhCN }

export function loadMessages(locale: Locale): Messages {
  return CATALOGS[locale]
}
