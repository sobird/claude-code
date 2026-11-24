'use client'

/**
 * 设备码批准面板：输入短码 → 预览机器 → 批准；下方常驻「连接一台机器」的安装命令。
 *
 * 批准本身不需要生成任何 key（服务器只记用户），所以这里只做预览/批准两步，
 * 失败时用 `errors.codes.*` 的稳定错误码文案。
 */

import { Check, Copy, Laptop } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useSettingsApi } from '@/components/settings/use-settings-api'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { useApiErrorMessage } from '@/hooks/useApiErrorMessage'
import { createApiClient } from '@/lib/api-client'

import styles from './DeviceApproval.module.css'

interface DevicePreview {
  client: string | null
  hostname: string | null
  expires_at: number
  status: string
}

interface ApproveResult {
  ok: boolean
  name: string
}

/** 插件在本地仓库里的安装路径由用户填写；命令其余部分由本页给出。 */
const PLUGIN_PATH_PLACEHOLDER = '<path to packages/dsh-rcs-plugin>'

export function DeviceApproval() {
  const t = useTranslations('device')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const describeError = useApiErrorMessage()
  const { token, tokenError, refresh } = useSettingsApi()
  const api = useMemo(() => createApiClient({ getToken: () => token, refreshToken: refresh }), [token, refresh])

  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<DevicePreview | null>(null)
  const [approved, setApproved] = useState<ApproveResult | null>(null)
  const [busy, setBusy] = useState<'lookup' | 'approve' | null>(null)
  const [error, setError] = useState<unknown>(null)

  const [origin, setOrigin] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  // `window` 只在挂载后可用；放进 effect 避免把 origin 写进首屏 HTML 破坏水合。
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const installCommand = origin ? `RCS_BASE_URL=${origin} dsh plugin --profile sdk add ${PLUGIN_PATH_PLACEHOLDER}` : ''
  const ready = token !== null

  async function handleLookup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || busy || !ready) return
    setBusy('lookup')
    setError(null)
    setPreview(null)
    setApproved(null)
    setCopied(false)
    setCopyError(false)
    try {
      const result = await api.get<DevicePreview>(`/web/auth/device/${encodeURIComponent(trimmed)}`)
      setPreview(result)
    } catch (lookupError) {
      setError(lookupError)
    } finally {
      setBusy(null)
    }
  }

  async function handleApprove(): Promise<void> {
    if (busy || !ready) return
    setBusy('approve')
    setError(null)
    try {
      const result = await api.post<ApproveResult>('/web/auth/device/approve', { user_code: code.trim() })
      setApproved(result)
      setPreview(null)
      setCode('')
    } catch (approveError) {
      setError(approveError)
    } finally {
      setBusy(null)
    }
  }

  function startOver(): void {
    setApproved(null)
    setPreview(null)
    setCode('')
    setError(null)
  }

  async function copyCommand(): Promise<void> {
    if (!installCommand) return
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  const errorMessage =
    tokenError !== null ? tErrors('tokenUnavailable') : error !== null ? describeError(error, 'errors.generic') : null

  return (
    <div className={styles.root}>
      <Card className={styles.card}>
        <CardHeader>
          <CardTitle className={styles.cardTitle}>{t('approveTitle')}</CardTitle>
          <CardDescription className={styles.description}>{t('approveDescription')}</CardDescription>
        </CardHeader>
        <CardContent className={styles.content}>
          {approved ? (
            <div className={styles.success}>
              <Check className={styles.icon} />
              <div className={styles.successText}>
                <p className={styles.successTitle}>{t('approved')}</p>
                <p className={styles.muted}>{approved.name}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={startOver}>
                {t('startOver')}
              </Button>
            </div>
          ) : preview ? (
            <div className={styles.preview}>
              <div className={styles.machine}>
                <Laptop className={styles.icon} />
                <div>
                  <p className={styles.machineName}>{preview.hostname || preview.client || t('unknownMachine')}</p>
                  <p className={styles.muted}>{preview.client ?? t('unknownClient')}</p>
                </div>
              </div>
              <div className={styles.actions}>
                <Button type="button" variant="outline" size="sm" onClick={startOver} disabled={busy !== null}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  size="sm"
                  onClick={() => void handleApprove()}
                  disabled={busy !== null}
                >
                  {busy === 'approve' ? t('approving') : t('approve')}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleLookup} className={styles.form}>
              <div className={styles.field}>
                <Label htmlFor="device-code" className={styles.label}>
                  {t('codeLabel')}
                </Label>
                <Input
                  id="device-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={t('codePlaceholder')}
                  disabled={!ready || busy !== null}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={styles.input}
                />
              </div>
              <Button type="submit" variant="brand" disabled={!ready || busy !== null || code.trim().length === 0}>
                {busy === 'lookup' ? t('lookingUp') : t('lookup')}
              </Button>
            </form>
          )}

          {errorMessage !== null ? (
            <p role="alert" className={styles.error}>
              {errorMessage}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className={styles.card}>
        <CardHeader>
          <CardTitle className={styles.cardTitle}>{t('install.title')}</CardTitle>
          <CardDescription className={styles.description}>{t('install.description')}</CardDescription>
        </CardHeader>
        <CardContent className={styles.content}>
          <pre className={styles.command}>{installCommand}</pre>
          {copyError ? (
            <p role="alert" className={styles.error}>
              {t('install.copyError')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyCommand()}
            disabled={!installCommand}
          >
            <Copy className={styles.icon} />
            {copied ? t('install.copied') : t('install.copy')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
