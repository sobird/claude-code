// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'

import { loadMessages } from './catalogs'
import { resolveRequestLocale } from './server'

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale()
  return { locale, messages: loadMessages(locale) }
})
