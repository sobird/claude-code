import React, { useEffect, useMemo, useRef, useState } from 'react'

import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  BEDROCK_STEP,
  type BedrockAuthMethod,
  type BedrockSetupData,
  type BedrockVerification,
  buildBedrockEnv,
  discoverAwsProfiles,
  getModelOptionsForTier,
  getModelPinCandidates,
  HIDDEN_ENV_KEYS,
  hasManyProfiles,
  MODEL_TEST_REASON_LABELS,
  MODEL_TIER_LABELS,
  MODEL_TIERS,
  type ModelTestResult,
  type ModelTier,
  pickDefaultModel,
  testBedrockModel,
  verifyBedrockCredentials,
} from '../utils/bedrockSetup.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { plural } from '../utils/stringUtils.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/select.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { StatusIcon } from './design-system/StatusIcon.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'
import { type WizardStepComponent, useWizard, WizardDialogLayout, WizardProvider } from './wizard/index.js'

type Props = {
  onComplete: (message: string) => void
  onCancel: () => void
}

const CONTINUE_FOOTER = (
  <Byline>
    <KeyboardShortcutHint shortcut="Enter" action="continue" />
    <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" />
  </Byline>
)

const MANUAL_PROFILE_VALUE = '__manual__'

function StatusMessage({ message, subtitle }: { message: string; subtitle?: string }): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Spinner />
        <Text> {message}</Text>
      </Box>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
    </Box>
  )
}

/** Step 0: choose how to authenticate to AWS. */
function AuthMethodStep(): React.ReactNode {
  const { goBack, goToStep, updateWizardData } = useWizard<BedrockSetupData>()
  const stepByMethod: Record<BedrockAuthMethod, number> = {
    profile: BEDROCK_STEP.PROFILE,
    bearer: BEDROCK_STEP.BEARER,
    accessKey: BEDROCK_STEP.ACCESS_KEY_ID,
    environment: BEDROCK_STEP.REGION,
  }

  return (
    <WizardDialogLayout subtitle="How do you authenticate to AWS?">
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Claude Code uses the standard AWS credential chain. Pick the method you already use with the AWS CLI.
        </Text>
        <Select
          options={[
            { label: 'AWS profile (SSO or named profile)', value: 'profile' as const },
            { label: 'Bedrock API key (bearer token)', value: 'bearer' as const },
            { label: 'Access key + secret', value: 'accessKey' as const },
            { label: 'Use credentials already in my environment', value: 'environment' as const },
          ]}
          onChange={(method) => {
            updateWizardData({ authMethod: method })
            goToStep(stepByMethod[method])
          }}
          onCancel={goBack}
        />
      </Box>
    </WizardDialogLayout>
  )
}

type ProfilePhase = { phase: 'loading' } | { phase: 'ready'; profiles: string[] }

/** Step 1: pick a named profile from ~/.aws/config (or type one). */
function ProfileStep(): React.ReactNode {
  const [state, setState] = useState<ProfilePhase>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    void discoverAwsProfiles().then((profiles) => {
      if (!cancelled) {
        setState({ phase: 'ready', profiles })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.phase === 'loading') {
    return (
      <WizardDialogLayout subtitle="AWS profile">
        <StatusMessage message="Reading ~/.aws/config…" />
      </WizardDialogLayout>
    )
  }
  return <ProfilePicker profiles={state.profiles} />
}

function ProfilePicker({ profiles }: { profiles: string[] }): React.ReactNode {
  const { goBack, goToStep, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const needsManual =
    profiles.length === 0 ||
    hasManyProfiles(profiles) ||
    Boolean(wizardData.awsProfile && !profiles.includes(wizardData.awsProfile))
  const [manual, setManual] = useState(needsManual)
  const suggested = hasManyProfiles(profiles) ? profiles.find((p) => p.toLowerCase().includes('bedrock')) : undefined
  const [profileName, setProfileName] = useState(wizardData.awsProfile ?? suggested ?? '')
  const [cursorOffset, setCursorOffset] = useState(profileName.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings', isActive: manual })

  const submit = (name: string): void => {
    updateWizardData({ awsProfile: name })
    goToStep(BEDROCK_STEP.REGION)
  }

  if (!manual) {
    return (
      <WizardDialogLayout subtitle="AWS profile">
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            Found {profiles.length} {plural(profiles.length, 'profile')} in ~/.aws/config and ~/.aws/credentials.
          </Text>
          <Select
            options={[
              ...profiles.map((profile) => ({ label: profile, value: profile })),
              { label: 'Type a different name…', value: MANUAL_PROFILE_VALUE },
            ]}
            defaultValue={
              wizardData.awsProfile && profiles.includes(wizardData.awsProfile) ? wizardData.awsProfile : undefined
            }
            onChange={(value) => {
              if (value === MANUAL_PROFILE_VALUE) {
                setManual(true)
              } else {
                submit(value)
              }
            }}
            onCancel={goBack}
          />
        </Box>
      </WizardDialogLayout>
    )
  }

  const handleSubmit = (): void => {
    const trimmed = profileName.trim()
    if (!trimmed) {
      setError('Profile name is required')
      return
    }
    setError(null)
    submit(trimmed)
  }

  return (
    <WizardDialogLayout subtitle="AWS profile name" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Box marginTop={1}>
          <TextInput
            value={profileName}
            onChange={setProfileName}
            onSubmit={handleSubmit}
            placeholder="default"
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardDialogLayout>
  )
}

/** Step 2: Bedrock API key (bearer token). */
function BearerTokenStep(): React.ReactNode {
  const { goBack, goToStep, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [value, setValue] = useState(wizardData.bearerToken ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('API key is required')
      return
    }
    setError(null)
    updateWizardData({ bearerToken: trimmed })
    goToStep(BEDROCK_STEP.REGION)
  }

  return (
    <WizardDialogLayout subtitle="Bedrock API key" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text>Paste your Bedrock API key.</Text>
        <Text dimColor>Generate one in the AWS console under Bedrock → API keys.</Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="bedrock-api-key-…"
            mask="*"
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardDialogLayout>
  )
}

/** Step 3: AWS access key id. */
function AccessKeyIdStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [value, setValue] = useState(wizardData.accessKeyId ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Access key ID is required')
      return
    }
    setError(null)
    updateWizardData({ accessKeyId: trimmed })
    goNext()
  }

  return (
    <WizardDialogLayout subtitle="AWS access key ID" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="AKIA…"
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardDialogLayout>
  )
}

/** Step 4: AWS secret access key. */
function SecretAccessKeyStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [value, setValue] = useState(wizardData.secretAccessKey ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Secret access key is required')
      return
    }
    setError(null)
    updateWizardData({ secretAccessKey: trimmed })
    goNext()
  }

  return (
    <WizardDialogLayout subtitle="AWS secret access key" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            mask="*"
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardDialogLayout>
  )
}

/** Step 5: optional STS session token for temporary credentials. */
function SessionTokenStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [value, setValue] = useState(wizardData.sessionToken ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    updateWizardData({ sessionToken: value.trim() || undefined })
    goNext()
  }

  return (
    <WizardDialogLayout subtitle="AWS session token (optional)" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text dimColor>Only needed for temporary credentials from STS. Leave empty for long-lived keys.</Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            mask="*"
            columns={60}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
      </Box>
    </WizardDialogLayout>
  )
}

/** Step 6: Bedrock region (read from AWS_REGION, not ~/.aws/config). */
function RegionStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [value, setValue] = useState(wizardData.region ?? 'us-east-1')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Region is required')
      return
    }
    setError(null)
    updateWizardData({ region: trimmed })
    goNext()
  }

  return (
    <WizardDialogLayout subtitle="AWS region" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text>Where your Bedrock models are enabled.</Text>
        <Text dimColor>
          Claude Code reads this from AWS_REGION, not ~/.aws/config — set it explicitly even if your profile has a
          region.
        </Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="us-east-1"
            columns={40}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardDialogLayout>
  )
}

type VerifyPhase = { phase: 'checking' } | { phase: 'done'; result: BedrockVerification }

/** Step 7: prove the credentials against STS / Bedrock. */
function VerifyStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const [state, setState] = useState<VerifyPhase>({ phase: 'checking' })

  useEffect(() => {
    let cancelled = false
    void verifyBedrockCredentials(wizardData).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') {
        updateWizardData({ verifiedIdentity: result.identity, discoveredProfiles: result.profiles })
      }
      setState({ phase: 'done', result })
    })
    return () => {
      cancelled = true
    }
    // Runs once on mount: the wizard data is fixed by the time we reach this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.phase === 'checking') {
    return (
      <WizardDialogLayout subtitle="Verifying credentials">
        <StatusMessage
          message={
            wizardData.authMethod === 'bearer' ? 'Sending a test request to Bedrock…' : 'Calling AWS STS and Bedrock…'
          }
          subtitle="This may take a few seconds."
        />
      </WizardDialogLayout>
    )
  }

  const { result } = state

  if (result.status === 'ok') {
    const profilesMessage =
      result.profiles.length > 0
        ? `Found ${result.profiles.length} Anthropic inference ${plural(result.profiles.length, 'profile')} in this region.`
        : 'No Anthropic inference profiles found in this region. You may still proceed — model defaults will use the built-in IDs.'
    return (
      <WizardDialogLayout subtitle="Verification">
        <Box flexDirection="column" gap={1}>
          <Text>
            <StatusIcon status="success" withSpace />
            Authenticated as <Text bold>{result.identity}</Text>
          </Text>
          <Text dimColor>{result.note ?? profilesMessage}</Text>
          <Select options={[{ label: 'Continue', value: 'continue' }]} onChange={() => goNext()} onCancel={goBack} />
        </Box>
      </WizardDialogLayout>
    )
  }

  return (
    <WizardDialogLayout subtitle="Verification failed" color="error">
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            <StatusIcon status="error" withSpace />
            {result.error}
          </Text>
          {result.command ? (
            <Text bold color="suggestion">
              {'    '}
              {result.command}
            </Text>
          ) : null}
        </Box>
        <Select
          options={[
            { label: 'Go back and fix', value: 'back' },
            { label: 'Save anyway (skip verification)', value: 'skip' },
          ]}
          onChange={(value) => {
            if (value === 'back') goBack()
            else goNext()
          }}
          onCancel={goBack}
        />
      </Box>
    </WizardDialogLayout>
  )
}

type ModelTestState = ModelTestResult | 'pending'

/** Step 8: pin one model per tier (each candidate is probed with a 1-token request). */
function PinModelsStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<BedrockSetupData>()
  const discovered = wizardData.discoveredProfiles ?? []
  const candidates = useMemo(() => getModelPinCandidates(wizardData.region), [wizardData.region])
  const [picked, setPicked] = useState<Record<ModelTier, string>>(() => ({
    sonnet: pickDefaultModel(discovered, candidates.sonnet).model,
    opus: pickDefaultModel(discovered, candidates.opus).model,
    haiku: pickDefaultModel(discovered, candidates.haiku).model,
  }))
  const [results, setResults] = useState<Record<ModelTier, ModelTestState>>({
    sonnet: 'pending',
    opus: 'pending',
    haiku: 'pending',
  })
  const [picking, setPicking] = useState<ModelTier | null>(null)

  useEffect(() => {
    let cancelled = false
    setResults((prev) => ({ ...prev, sonnet: 'pending' }))
    void testBedrockModel(wizardData, picked.sonnet).then((result) => {
      if (!cancelled) setResults((prev) => ({ ...prev, sonnet: result }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.sonnet])

  useEffect(() => {
    let cancelled = false
    setResults((prev) => ({ ...prev, opus: 'pending' }))
    void testBedrockModel(wizardData, picked.opus).then((result) => {
      if (!cancelled) setResults((prev) => ({ ...prev, opus: result }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.opus])

  useEffect(() => {
    let cancelled = false
    setResults((prev) => ({ ...prev, haiku: 'pending' }))
    void testBedrockModel(wizardData, picked.haiku).then((result) => {
      if (!cancelled) setResults((prev) => ({ ...prev, haiku: result }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.haiku])

  if (picking !== null) {
    const tier = picking
    const order = MODEL_TIERS
    return (
      <TierPicker
        tier={tier}
        fallback={candidates[tier].fallback}
        current={picked[tier]}
        onPick={(model) => {
          setPicked((prev) => ({ ...prev, [tier]: model }))
          const nextTier = order[order.indexOf(tier) + 1]
          setPicking(nextTier ?? null)
        }}
        onCancel={() => setPicking(null)}
      />
    )
  }

  const anyOk = MODEL_TIERS.some((tier) => results[tier] !== 'pending' && results[tier].ok)

  const handleChoice = (value: string): void => {
    if (value === 'manual') {
      setPicking('sonnet')
      return
    }
    if (value === 'pin') {
      const working = (tier: ModelTier): string | undefined => {
        const result = results[tier]
        return result !== 'pending' && result.ok ? picked[tier] : undefined
      }
      updateWizardData({
        pinSonnet: working('sonnet'),
        pinOpus: working('opus'),
        pinHaiku: working('haiku'),
      })
    } else {
      updateWizardData({ pinSonnet: undefined, pinOpus: undefined, pinHaiku: undefined })
    }
    goNext()
  }

  return (
    <WizardDialogLayout subtitle="Pin model versions">
      <Box flexDirection="column" gap={1}>
        <Text>
          Without pinning, Claude Code uses its built-in defaults. When a new model ships, your install will try to call
          it even if your account has not yet enabled it — Claude Code will fail to connect to Bedrock until you enable
          the model or pin to one you have.
        </Text>
        <Box flexDirection="column">
          <Text dimColor>Each candidate is tested with a one-token request:</Text>
          {MODEL_TIERS.map((tier) => (
            <PinCandidateLine key={tier} label={MODEL_TIER_LABELS[tier]} modelId={picked[tier]} state={results[tier]} />
          ))}
        </Box>
        <Select
          options={[
            ...(anyOk ? [{ label: 'Pin the working models', value: 'pin' }] : []),
            { label: 'Choose different models…', value: 'manual' },
            { label: 'Skip — use Claude Code defaults (auto-updates)', value: 'skip' },
          ]}
          onChange={handleChoice}
          onCancel={goBack}
        />
      </Box>
    </WizardDialogLayout>
  )
}

function PinCandidateLine({
  label,
  modelId,
  state,
}: {
  label: string
  modelId: string
  state: ModelTestState
}): React.ReactNode {
  if (state === 'pending') {
    return (
      <Box>
        <Text>{'  '}</Text>
        <Spinner />
        <Text>
          {' '}
          {label.padEnd(7)}→ {modelId}
        </Text>
      </Box>
    )
  }
  if (state.ok) {
    return (
      <Text>
        {'  '}
        <StatusIcon status="success" withSpace />
        {label.padEnd(7)}→ <Text color="success">{modelId}</Text>
      </Text>
    )
  }
  return (
    <Text>
      {'  '}
      <StatusIcon status="error" withSpace />
      {label.padEnd(7)}→ <Text dimColor>{modelId}</Text>{' '}
      <Text color="error">({MODEL_TEST_REASON_LABELS[state.reason]})</Text>
    </Text>
  )
}

function TierPicker({
  tier,
  fallback,
  current,
  onPick,
  onCancel,
}: {
  tier: ModelTier
  fallback: string
  current: string
  onPick: (model: string) => void
  onCancel: () => void
}): React.ReactNode {
  const { wizardData } = useWizard<BedrockSetupData>()
  const profiles = wizardData.discoveredProfiles ?? []
  const options = useMemo(
    () => getModelOptionsForTier(tier, profiles, fallback, current),
    [tier, profiles, fallback, current],
  )
  const [states, setStates] = useState<Record<string, ModelTestState>>(() =>
    Object.fromEntries(options.map((option) => [option, 'pending' as const])),
  )

  useEffect(() => {
    let cancelled = false
    for (const option of options) {
      void testBedrockModel(wizardData, option).then((result) => {
        if (!cancelled) setStates((prev) => ({ ...prev, [option]: result }))
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const settled = options.every((option) => states[option] !== 'pending')
  const isOk = (option: string): boolean => {
    const state = states[option]
    return state !== undefined && state !== 'pending' && state.ok
  }
  const sorted = settled ? [...options].toSorted((a, b) => (isOk(a) ? 0 : 1) - (isOk(b) ? 0 : 1)) : options
  const matchCount = profiles.filter((profile) => profile.toLowerCase().includes(tier)).length

  return (
    <WizardDialogLayout subtitle={`Pin ${MODEL_TIER_LABELS[tier]} model`}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {matchCount > 0
            ? `${matchCount} ${MODEL_TIER_LABELS[tier]} ${plural(matchCount, 'profile')} in your account · each tested with a one-token request.`
            : `No ${MODEL_TIER_LABELS[tier]} profiles found in your account.`}
        </Text>
        <Select
          options={sorted.map((option) => ({
            value: option,
            label: (
              <ModelOptionLabel
                id={option}
                state={states[option] ?? 'pending'}
                suffix={option === fallback ? '(built-in default)' : option === current ? '(current)' : undefined}
              />
            ),
          }))}
          defaultValue={settled ? sorted.find(isOk) : current}
          onChange={onPick}
          onCancel={onCancel}
        />
      </Box>
    </WizardDialogLayout>
  )
}

function ModelOptionLabel({
  id,
  state,
  suffix,
}: {
  id: string
  state: ModelTestState
  suffix?: string
}): React.ReactNode {
  const suffixNode = suffix ? <Text dimColor> {suffix}</Text> : null
  if (state === 'pending') {
    return (
      <Text>
        <StatusIcon status="pending" withSpace />
        {id}
        {suffixNode}
      </Text>
    )
  }
  if (state.ok) {
    return (
      <Text>
        <StatusIcon status="success" withSpace />
        {id}
        {suffixNode}
      </Text>
    )
  }
  return (
    <Text dimColor>
      <StatusIcon status="error" withSpace />
      {id}
      {suffix ? ` ${suffix}` : ''} <Text color="error">({MODEL_TEST_REASON_LABELS[state.reason]})</Text>
    </Text>
  )
}

/** Step 9: review the env block and save it to user settings. */
function ConfirmStep({ onComplete }: { onComplete: (message: string) => void }): React.ReactNode {
  const { goBack, wizardData } = useWizard<BedrockSetupData>()
  const [error, setError] = useState<string | null>(null)
  const entries = useMemo(
    () =>
      Object.entries(buildBedrockEnv(wizardData)).filter((entry): entry is [string, string] => entry[1] !== undefined),
    [wizardData],
  )

  const handleSave = (): void => {
    const settingsEnv = Object.fromEntries(entries)
    const { error: saveError } = updateSettingsForSource('userSettings', { env: settingsEnv })
    if (saveError) {
      setError(saveError.message)
      return
    }
    logEvent('tengu_bedrock_setup_complete', {
      auth_method: String(wizardData.authMethod) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      pinned_models: String(
        Boolean(wizardData.pinSonnet || wizardData.pinOpus || wizardData.pinHaiku),
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      verified: String(
        Boolean(wizardData.verifiedIdentity),
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    const ssoHint =
      wizardData.authMethod === 'profile'
        ? ` When your SSO session expires (typically 8 hours), run \`aws sso login --profile ${wizardData.awsProfile}\` — Claude Code picks up refreshed credentials automatically.`
        : ''
    onComplete(`Bedrock configuration saved to ~/.claude/settings.json. Restart Claude Code to apply.${ssoHint}`)
  }

  return (
    <WizardDialogLayout subtitle="Confirm and save">
      <Box flexDirection="column" gap={1}>
        <Text>These will be written to ~/.claude/settings.json under env:</Text>
        <Box flexDirection="column">
          {entries.map(([key, value]) => (
            <Text key={key}>
              {'  '}
              <Text color="suggestion">{key}</Text> ={' '}
              {HIDDEN_ENV_KEYS.has(key) ? <Text dimColor>(hidden)</Text> : value}
            </Text>
          ))}
        </Box>
        {wizardData.verifiedIdentity ? (
          <Text dimColor>
            <StatusIcon status="success" withSpace />
            Verified as {wizardData.verifiedIdentity}
          </Text>
        ) : null}
        {error ? <Text color="error">{error}</Text> : null}
        <Select
          options={[
            { label: 'Save', value: 'save' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={(value) => {
            if (value === 'save') handleSave()
            else goBack()
          }}
          onCancel={goBack}
        />
      </Box>
    </WizardDialogLayout>
  )
}

/**
 * Multi-step AWS Bedrock setup wizard shared by the `/setup-bedrock` command
 * and the login screen's "3rd-party platform" entry.
 */
export function BedrockSetupWizard({ onComplete, onCancel }: Props): React.ReactNode {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const [steps] = useState<WizardStepComponent<BedrockSetupData>[]>(() => [
    AuthMethodStep,
    ProfileStep,
    BearerTokenStep,
    AccessKeyIdStep,
    SecretAccessKeyStep,
    SessionTokenStep,
    RegionStep,
    VerifyStep,
    PinModelsStep,
    () => <ConfirmStep onComplete={(message) => onCompleteRef.current(message)} />,
  ])

  return (
    <WizardProvider
      steps={steps}
      initialData={{}}
      onComplete={() => {}}
      onCancel={onCancel}
      title="Set up AWS Bedrock"
      showStepCounter={false}
    />
  )
}
