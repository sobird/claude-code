import figures from 'figures'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

import { installOAuthTokens } from '../cli/handlers/auth.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Link, Text } from '../ink.js'
import { setClipboard } from '../ink/termio/osc.js'
import { useTerminalNotification } from '../ink/useTerminalNotification.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { getSSLErrorHint } from '../services/api/errorUtils.js'
import { sendNotification } from '../services/notifier.js'
import { OAuthService } from '../services/oauth/index.js'
import { getOauthAccountInfo, validateForceLoginOrg } from '../utils/auth.js'
import { logError } from '../utils/log.js'
import { maskSecretForDisplay } from '../utils/secretMask.js'
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/select.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import {
  buildPlatformEnv,
  PLATFORM_DEFINITIONS,
  type PlatformFormValues,
  type PlatformKind,
  readPlatformFromEnv,
  validatePlatformValues,
} from './platformConfig.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'

type Props = {
  onDone: () => void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
}

/**
 * Platform setup: configure a custom endpoint and the model used per tier.
 * Anthropic-compatible endpoints are used as-is; OpenAI and Gemini endpoints
 * are translated by src/services/api/providerAdapters.
 */
interface PlatformConfigStatus extends PlatformFormValues {
  state: 'platform_config'
  platform: PlatformKind
}

type OAuthStatus =
  | { state: 'idle' } // Initial state, waiting to select login method
  | PlatformConfigStatus // Configure a custom API endpoint and model names
  | { state: 'platform_setup' } // Show platform setup info (Bedrock/Vertex/Foundry)
  | { state: 'ready_to_start' } // Flow started, waiting for browser to open
  | { state: 'waiting_for_login'; url: string } // Browser opened, waiting for user to login
  | { state: 'creating_api_key' } // Got access token, creating API key
  | { state: 'about_to_retry'; nextState: OAuthStatus }
  | { state: 'success'; token?: string }
  | {
      state: 'error'
      message: string
      toRetry?: OAuthStatus
    }

const PASTE_HERE_MSG = 'Paste code here if prompted > '

export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {}
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod
  const orgUUID = settings.forceLoginOrgUUID
  const forcedMethodMessage =
    forceLoginMethod === 'claudeai'
      ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)'
      : forceLoginMethod === 'console'
        ? 'Login method pre-selected: API Usage Billing (Anthropic Console)'
        : null

  const terminal = useTerminalNotification()

  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return { state: 'ready_to_start' }
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return { state: 'ready_to_start' }
    }
    return { state: 'idle' }
  })

  const [pastedCode, setPastedCode] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [oauthService] = useState(() => new OAuthService())
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai'
  })
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)

  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1

  // Log forced login method on mount
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {})
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {})
    }
  }, [forceLoginMethod])

  // Retry logic
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState)
      return () => clearTimeout(timer)
    }
    return () => {}
  }, [oauthStatus])

  // Handle Enter to continue on success state
  useKeybinding(
    'confirm:yes',
    () => {
      logEvent('tengu_oauth_success', { loginWithClaudeAi })
      onDone()
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'success' && mode !== 'setup-token',
    },
  )

  // Handle Enter to continue from platform setup
  useKeybinding(
    'confirm:yes',
    () => {
      setOAuthStatus({ state: 'idle' })
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'platform_setup',
    },
  )

  // Handle Enter to retry on error state
  useKeybinding(
    'confirm:yes',
    () => {
      if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
        setPastedCode('')
        setOAuthStatus({
          state: 'about_to_retry',
          nextState: oauthStatus.toRetry,
        })
      }
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry,
    },
  )

  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then((raw) => {
        if (raw) process.stdout.write(raw)
        setUrlCopied(true)
        setTimeout(setUrlCopied, 2000, false)
      })
      setPastedCode('')
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied])

  async function handleSubmitCode(value: string, url: string) {
    try {
      // Expecting format "authorizationCode#state" from the authorization callback URL
      const [authorizationCode, state] = value.split('#')

      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: { state: 'waiting_for_login', url },
        })
        return
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {})
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state,
      })
    } catch (err: unknown) {
      logError(err)
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: { state: 'waiting_for_login', url },
      })
    }
  }

  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

      const result = await oauthService
        .startOAuthFlow(
          async (url) => {
            setOAuthStatus({ state: 'waiting_for_login', url })
            setTimeout(setShowPastePrompt, 3000, true)
          },
          {
            loginWithClaudeAi,
            inferenceOnly: mode === 'setup-token',
            expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined, // 1 year for setup-token
            orgUUID,
          },
        )
        .catch((err) => {
          const isTokenExchangeError = err.message.includes('Token exchange failed')
          // Enterprise TLS proxies (Zscaler et al.) intercept the token
          // exchange POST and cause cryptic SSL errors. Surface an
          // actionable hint so the user isn't stuck in a login loop.
          const sslHint = getSSLErrorHint(err)
          setOAuthStatus({
            state: 'error',
            message:
              sslHint ??
              (isTokenExchangeError
                ? 'Failed to exchange authorization code for access token. Please try again.'
                : err.message),
            toRetry: mode === 'setup-token' ? { state: 'ready_to_start' } : { state: 'idle' },
          })
          logEvent('tengu_oauth_token_exchange_error', {
            error: err.message,
            ssl_error: sslHint !== null,
          })
          throw err
        })

      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({ state: 'success', token: result.accessToken })
      } else {
        await installOAuthTokens(result)

        const orgResult = await validateForceLoginOrg()
        if (!orgResult.valid) {
          throw new Error(orgResult.message)
        }

        setOAuthStatus({ state: 'success' })
        void sendNotification(
          {
            message: 'Claude Code login successful',
            notificationType: 'auth_success',
          },
          terminal,
        )
      }
    } catch (err) {
      const errorMessage = (err as Error).message
      const sslHint = getSSLErrorHint(err)
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle',
        },
      })
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null,
      })
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID])

  const pendingOAuthStartRef = useRef(false)

  useEffect(() => {
    if (oauthStatus.state === 'ready_to_start' && !pendingOAuthStartRef.current) {
      pendingOAuthStartRef.current = true
      process.nextTick(
        (startOAuth: () => Promise<void>, pendingOAuthStartRef: React.MutableRefObject<boolean>) => {
          void startOAuth()
          pendingOAuthStartRef.current = false
        },
        startOAuth,
        pendingOAuthStartRef,
      )
    }
  }, [oauthStatus.state, startOAuth])

  // Auto-exit for setup-token mode
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer = setTimeout(
        (loginWithClaudeAi, onDone) => {
          logEvent('tengu_oauth_success', { loginWithClaudeAi })
          // Don't clear terminal so the token remains visible
          onDone()
        },
        500,
        loginWithClaudeAi,
        onDone,
      )
      return () => clearTimeout(timer)
    }
    return () => {}
  }, [mode, oauthStatus, loginWithClaudeAi, onDone])

  // Cleanup OAuth service when component unmounts
  useEffect(() => {
    return () => {
      oauthService.cleanup()
    }
  }, [oauthService])

  return (
    <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && (
        <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>Browser didn&apos;t open? Use the url below to sign in </Text>
            {urlCopied ? (
              <Text color="success">(Copied!)</Text>
            ) : (
              <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>
            )}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>
      )}
      {mode === 'setup-token' && oauthStatus.state === 'success' && oauthStatus.token && (
        <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
          <Text color="success">✓ Long-lived authentication token created successfully!</Text>
          <Box flexDirection="column" gap={1}>
            <Text>Your OAuth token (valid for 1 year):</Text>
            <Text color="warning">{oauthStatus.token}</Text>
            <Text dimColor>Store this token securely. You won&apos;t be able to see it again.</Text>
            <Text dimColor>Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;</Text>
          </Box>
        </Box>
      )}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage
          oauthStatus={oauthStatus}
          mode={mode}
          startingMessage={startingMessage}
          forcedMethodMessage={forcedMethodMessage}
          showPastePrompt={showPastePrompt}
          pastedCode={pastedCode}
          setPastedCode={setPastedCode}
          cursorOffset={cursorOffset}
          setCursorOffset={setCursorOffset}
          textInputColumns={textInputColumns}
          handleSubmitCode={handleSubmitCode}
          setOAuthStatus={setOAuthStatus}
          setLoginWithClaudeAi={setLoginWithClaudeAi}
          onDone={onDone}
        />
      </Box>
    </Box>
  )
}

type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus
  mode: 'login' | 'setup-token'
  startingMessage: string | undefined
  forcedMethodMessage: string | null
  showPastePrompt: boolean
  pastedCode: string
  setPastedCode: (value: string) => void
  cursorOffset: number
  setCursorOffset: (offset: number) => void
  textInputColumns: number
  handleSubmitCode: (value: string, url: string) => void
  setOAuthStatus: (status: OAuthStatus) => void
  setLoginWithClaudeAi: (value: boolean) => void
  onDone: () => void
}

function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
  onDone,
}: OAuthStatusMessageProps): React.ReactNode {
  switch (oauthStatus.state) {
    case 'idle':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>
            {startingMessage
              ? startingMessage
              : `Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.`}
          </Text>

          <Text>Select login method:</Text>

          <Box>
            <Select
              options={[
                {
                  label: (
                    <Text>
                      Anthropic Compatible · <Text dimColor>Configure your own API endpoint</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'custom_platform',
                },
                {
                  label: (
                    <Text>
                      OpenAI Compatible · <Text dimColor>Ollama, DeepSeek, vLLM, One API, etc.</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'openai_platform',
                },
                {
                  label: (
                    <Text>
                      Gemini API · <Text dimColor>Google Gemini native REST/SSE</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'gemini_platform',
                },
                {
                  label: (
                    <Text>
                      Claude account with subscription · <Text dimColor>Pro, Max, Team, or Enterprise</Text>
                      {process.env.USER_TYPE === 'ant' && (
                        <Text>
                          {'\n'}
                          <Text color="warning">[ANT-ONLY]</Text>{' '}
                          <Text dimColor>
                            Please use this option unless you need to login to a special org for accessing sensitive
                            data (e.g. customer data, HIPI data) with the Console option
                          </Text>
                        </Text>
                      )}
                      {'\n'}
                    </Text>
                  ),
                  value: 'claudeai',
                },
                {
                  label: (
                    <Text>
                      Anthropic Console account · <Text dimColor>API usage billing</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'console',
                },
                {
                  label: (
                    <Text>
                      3rd-party platform · <Text dimColor>Amazon Bedrock, Microsoft Foundry, or Vertex AI</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'platform',
                },
              ]}
              onChange={(value) => {
                if (value === 'custom_platform' || value === 'openai_platform' || value === 'gemini_platform') {
                  const platform: PlatformKind =
                    value === 'custom_platform' ? 'anthropic' : value === 'openai_platform' ? 'openai' : 'gemini'
                  logEvent(
                    platform === 'anthropic'
                      ? 'tengu_custom_platform_selected'
                      : platform === 'openai'
                        ? 'tengu_openai_platform_selected'
                        : 'tengu_gemini_platform_selected',
                    {},
                  )
                  setOAuthStatus({
                    state: 'platform_config',
                    platform,
                    ...readPlatformFromEnv(platform),
                  })
                } else if (value === 'platform') {
                  logEvent('tengu_oauth_platform_selected', {})
                  setOAuthStatus({ state: 'platform_setup' })
                } else {
                  setOAuthStatus({ state: 'ready_to_start' })
                  if (value === 'claudeai') {
                    logEvent('tengu_oauth_claudeai_selected', {})
                    setLoginWithClaudeAi(true)
                  } else {
                    logEvent('tengu_oauth_console_selected', {})
                    setLoginWithClaudeAi(false)
                  }
                }
              }}
            />
          </Box>
        </Box>
      )

    case 'platform_config':
      return (
        <PlatformConfigForm
          key={oauthStatus.platform}
          platform={oauthStatus.platform}
          initial={{
            baseUrl: oauthStatus.baseUrl,
            apiKey: oauthStatus.apiKey,
            haikuModel: oauthStatus.haikuModel,
            sonnetModel: oauthStatus.sonnetModel,
            opusModel: oauthStatus.opusModel,
          }}
          onDone={onDone}
          onCancel={() => setOAuthStatus({ state: 'idle' })}
        />
      )

    case 'platform_setup':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>Using 3rd-party platforms</Text>

          <Box flexDirection="column" gap={1}>
            <Text>
              Claude Code supports Amazon Bedrock, Microsoft Foundry, and Vertex AI. Set the required environment
              variables, then restart Claude Code.
            </Text>

            <Text>
              If you are part of an enterprise organization, contact your administrator for setup instructions.
            </Text>

            <Box flexDirection="column" marginTop={1}>
              <Text bold>Documentation:</Text>
              <Text>
                · Amazon Bedrock:{' '}
                <Link url="https://code.claude.com/docs/en/amazon-bedrock">
                  https://code.claude.com/docs/en/amazon-bedrock
                </Link>
              </Text>
              <Text>
                · Microsoft Foundry:{' '}
                <Link url="https://code.claude.com/docs/en/microsoft-foundry">
                  https://code.claude.com/docs/en/microsoft-foundry
                </Link>
              </Text>
              <Text>
                · Vertex AI:{' '}
                <Link url="https://code.claude.com/docs/en/google-vertex-ai">
                  https://code.claude.com/docs/en/google-vertex-ai
                </Link>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text bold>Enter</Text> to go back to login options.
              </Text>
            </Box>
          </Box>
        </Box>
      )

    case 'waiting_for_login':
      return (
        <Box flexDirection="column" gap={1}>
          {forcedMethodMessage && (
            <Box>
              <Text dimColor>{forcedMethodMessage}</Text>
            </Box>
          )}

          {!showPastePrompt && (
            <Box>
              <Spinner />
              <Text>Opening browser to sign in…</Text>
            </Box>
          )}

          {showPastePrompt && (
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={pastedCode}
                onChange={setPastedCode}
                onSubmit={(value: string) => handleSubmitCode(value, oauthStatus.url)}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                mask="*"
              />
            </Box>
          )}
        </Box>
      )

    case 'creating_api_key':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Creating API key for Claude Code…</Text>
          </Box>
        </Box>
      )

    case 'about_to_retry':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="permission">Retrying…</Text>
        </Box>
      )

    case 'success':
      return (
        <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : (
            <>
              {getOauthAccountInfo()?.emailAddress ? (
                <Text dimColor>
                  Logged in as <Text>{getOauthAccountInfo()?.emailAddress}</Text>
                </Text>
              ) : null}
              <Text color="success">
                Login successful. Press <Text bold>Enter</Text> to continue…
              </Text>
            </>
          )}
        </Box>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">OAuth error: {oauthStatus.message}</Text>

          {oauthStatus.toRetry && (
            <Box marginTop={1}>
              <Text color="permission">
                Press <Text bold>Enter</Text> to retry.
              </Text>
            </Box>
          )}
        </Box>
      )

    default:
      return null
  }
}

type PlatformField = 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'

const PLATFORM_FIELDS: PlatformField[] = ['base_url', 'api_key', 'haiku_model', 'sonnet_model', 'opus_model']

const FIELD_VALUE_KEY: Record<PlatformField, keyof PlatformFormValues> = {
  base_url: 'baseUrl',
  api_key: 'apiKey',
  haiku_model: 'haikuModel',
  sonnet_model: 'sonnetModel',
  opus_model: 'opusModel',
}

function PlatformConfigForm({
  platform,
  initial,
  onDone,
  onCancel,
}: {
  platform: PlatformKind
  initial: PlatformFormValues
  onDone: () => void
  onCancel: () => void
}): React.ReactNode {
  const definition = PLATFORM_DEFINITIONS[platform]
  const [values, setValues] = useState(initial)
  const [activeField, setActiveField] = useState<PlatformField>('base_url')
  const [cursorOffset, setCursorOffset] = useState(initial.baseUrl.length)
  const [error, setError] = useState<string | null>(null)
  const columns = useTerminalSize().columns - 20

  const switchTo = useCallback(
    (field: PlatformField) => {
      setActiveField(field)
      setCursorOffset(values[FIELD_VALUE_KEY[field]].length)
    },
    [values],
  )

  const save = useCallback(() => {
    const validationError = validatePlatformValues(platform, values)
    if (validationError) {
      setError(validationError)
      return
    }
    const env = buildPlatformEnv(platform, values)
    const { error: saveError } = updateSettingsForSource('userSettings', { env })
    if (saveError) {
      setError('Failed to save settings. Please try again.')
      return
    }
    for (const [key, value] of Object.entries(env)) process.env[key] = value
    onDone()
  }, [platform, values, onDone])

  const handleEnter = useCallback(() => {
    const index = PLATFORM_FIELDS.indexOf(activeField)
    if (index === PLATFORM_FIELDS.length - 1) {
      save()
      return
    }
    switchTo(PLATFORM_FIELDS[index + 1])
  }, [activeField, save, switchTo])

  useKeybinding(
    'tabs:next',
    () => {
      const index = PLATFORM_FIELDS.indexOf(activeField)
      if (index < PLATFORM_FIELDS.length - 1) switchTo(PLATFORM_FIELDS[index + 1])
    },
    { context: 'Tabs' },
  )

  useKeybinding(
    'tabs:previous',
    () => {
      const index = PLATFORM_FIELDS.indexOf(activeField)
      if (index > 0) switchTo(PLATFORM_FIELDS[index - 1])
    },
    { context: 'Tabs' },
  )

  // Settings context so plain 'n' can be typed; Esc goes back to login options.
  useKeybinding('confirm:no', onCancel, { context: 'Settings' })

  const renderRow = (field: PlatformField, label: string, opts?: { mask?: boolean; placeholder?: string }) => {
    const active = activeField === field
    const value = values[FIELD_VALUE_KEY[field]]
    return (
      <Box gap={1} key={field}>
        <Box width={10} backgroundColor={active ? 'suggestion' : undefined} justifyContent="flex-end">
          <Text color={active ? 'inverseText' : undefined}>{` ${label} `}</Text>
        </Box>
        {active ? (
          <TextInput
            value={value}
            onChange={(next) => {
              setValues((current) => ({ ...current, [FIELD_VALUE_KEY[field]]: next }))
              setError(null)
            }}
            onSubmit={handleEnter}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            columns={columns}
            mask={opts?.mask ? '*' : undefined}
            focus={true}
            showCursor={true}
          />
        ) : value ? (
          <Text color="success">{opts?.mask ? maskSecretForDisplay(value) : value}</Text>
        ) : (
          <Text dimColor>{opts?.placeholder ?? ''}</Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{definition.title}</Text>
      <Box flexDirection="column">
        {renderRow('base_url', 'Base URL', { placeholder: definition.baseUrlPlaceholder })}
        {renderRow('api_key', 'API Key', { mask: true })}
        {renderRow('haiku_model', 'Haiku')}
        {renderRow('sonnet_model', 'Sonnet')}
        {renderRow('opus_model', 'Opus')}
      </Box>
      {error ? <Text color="error">{error}</Text> : null}
      <Text dimColor>
        {figures.arrowUp + figures.arrowDown}/Tab to switch · Enter on last field to save · Esc to go back
      </Text>
    </Box>
  )
}
