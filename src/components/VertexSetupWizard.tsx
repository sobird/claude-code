import { homedir } from 'node:os'
import { join } from 'node:path'

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { plural } from '../utils/stringUtils.js'
import {
  buildVertexEnv,
  discoverGcpProjects,
  getDefaultVertexModels,
  getVertexModelOptionsForTier,
  hasManyProjects,
  MANUAL_PROJECT,
  MODEL_TEST_REASON_LABELS,
  MODEL_TIER_LABELS,
  MODEL_TIERS,
  type ModelTestResult,
  type ModelTier,
  testVertexModel,
  VERTEX_STEP,
  type VertexAuthMethod,
  type VertexSetupData,
  type VertexVerification,
  verifyVertexCredentials,
} from '../utils/vertexSetup.js'
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

/** Step 0: choose how to authenticate to Google Cloud. */
function AuthMethodStep(): React.ReactNode {
  const { goBack, goToStep, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const stepByMethod: Record<VertexAuthMethod, number> = {
    adc: VERTEX_STEP.PROJECT,
    serviceAccount: VERTEX_STEP.SERVICE_ACCOUNT,
    environment: VERTEX_STEP.PROJECT,
  }

  return (
    <WizardDialogLayout subtitle="How do you authenticate to Google Cloud?">
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Claude Code uses the standard GCP credential chain. Pick the method you already use with gcloud or in your
          deployment.
        </Text>
        <Select
          options={[
            { label: 'Application Default Credentials (gcloud auth)', value: 'adc' as const },
            { label: 'Service account key file', value: 'serviceAccount' as const },
            { label: 'Use credentials already in my environment', value: 'environment' as const },
          ]}
          defaultValue={wizardData.authMethod}
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

/** Step 1: path to a service account JSON key file (service-account only). */
function ServiceAccountKeyStep(): React.ReactNode {
  const { goBack, goToStep, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const [value, setValue] = useState(wizardData.keyFile ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings' })

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Path is required')
      return
    }
    setError(null)
    const keyFile = trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(1)) : trimmed
    updateWizardData({ keyFile })
    goToStep(VERTEX_STEP.PROJECT)
  }

  return (
    <WizardDialogLayout subtitle="Service account key" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text>Path to the service account JSON key file.</Text>
        <Text dimColor>Download one from the GCP console under IAM → Service Accounts → Keys → Add key.</Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="~/keys/my-project-vertex.json"
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

type ProjectPhase = { phase: 'loading' } | { phase: 'ready'; projects: string[] }

/** Step 2: pick the GCP project from gcloud config (or type one). */
function ProjectStep(): React.ReactNode {
  const [state, setState] = useState<ProjectPhase>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    void discoverGcpProjects().then((projects) => {
      if (!cancelled) {
        setState({ phase: 'ready', projects })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.phase === 'loading') {
    return (
      <WizardDialogLayout subtitle="GCP project">
        <StatusMessage message="Reading ~/.config/gcloud…" />
      </WizardDialogLayout>
    )
  }
  return <ProjectPicker projects={state.projects} />
}

function ProjectPicker({ projects }: { projects: string[] }): React.ReactNode {
  const { goBack, goToStep, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const tooMany = hasManyProjects(projects)
  const needsManual =
    projects.length === 0 || tooMany || Boolean(wizardData.projectId && !projects.includes(wizardData.projectId))
  const [manual, setManual] = useState(needsManual)
  const [projectId, setProjectId] = useState(wizardData.projectId ?? '')
  const [cursorOffset, setCursorOffset] = useState(projectId.length)
  const [error, setError] = useState<string | null>(null)

  useKeybinding('confirm:no', goBack, { context: 'Settings', isActive: manual })

  const submit = (id: string): void => {
    updateWizardData({ projectId: id })
    goToStep(VERTEX_STEP.REGION)
  }

  if (!manual) {
    return (
      <WizardDialogLayout subtitle="GCP project">
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            Found {projects.length} {plural(projects.length, 'project')} in your gcloud configurations.
          </Text>
          <Select
            options={[
              ...projects.map((project) => ({ label: project, value: project })),
              { label: 'Type a different project…', value: MANUAL_PROJECT },
            ]}
            defaultValue={
              wizardData.projectId && projects.includes(wizardData.projectId) ? wizardData.projectId : undefined
            }
            onChange={(value) => {
              if (value === MANUAL_PROJECT) {
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
    const trimmed = projectId.trim()
    if (!trimmed) {
      setError('Project ID is required')
      return
    }
    setError(null)
    submit(trimmed)
  }

  return (
    <WizardDialogLayout subtitle="GCP project" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text>The project where Vertex AI is enabled.</Text>
        <Text dimColor>
          {tooMany
            ? `Found ${projects.length} projects — too many to list.`
            : 'Find it with `gcloud config get-value project` or in the GCP console header.'}
        </Text>
        <Box marginTop={1}>
          <TextInput
            value={projectId}
            onChange={setProjectId}
            onSubmit={handleSubmit}
            placeholder="my-gcp-project"
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

/** Step 3: Vertex AI region (use `global` for the multi-region endpoint). */
function RegionStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const [value, setValue] = useState(wizardData.region ?? 'global')
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
    <WizardDialogLayout subtitle="Vertex AI region" footerText={CONTINUE_FOOTER}>
      <Box flexDirection="column">
        <Text>Where Claude models are served from.</Text>
        <Text dimColor>
          Use 'global' for the multi-region endpoint (recommended), or a specific location like us-east5 if you have
          regional quota.
        </Text>
        <Box marginTop={1}>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="global"
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

type VerifyPhase = { phase: 'checking' } | { phase: 'done'; result: VertexVerification }

/** Step 4: prove the credentials against Google Cloud. */
function VerifyStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const [state, setState] = useState<VerifyPhase>({ phase: 'checking' })

  useEffect(() => {
    let cancelled = false
    void verifyVertexCredentials(wizardData).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') {
        updateWizardData({ verifiedIdentity: result.identity })
      } else {
        updateWizardData({ verifiedIdentity: undefined })
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
        <StatusMessage message="Calling Google Cloud…" subtitle="This may take a few seconds." />
      </WizardDialogLayout>
    )
  }

  const { result } = state

  if (result.status === 'ok') {
    return (
      <WizardDialogLayout subtitle="Verification">
        <Box flexDirection="column" gap={1}>
          <Text>
            <StatusIcon status="success" withSpace />
            Authenticated as <Text bold>{result.identity}</Text>
          </Text>
          {result.note ? <Text dimColor>{result.note}</Text> : null}
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

type PickingState = 'summary' | { picking: ModelTier }

/** Step 5: pin one model per tier (each candidate is probed with a 1-token request). */
function PinModelsStep(): React.ReactNode {
  const { goBack, goNext, updateWizardData, wizardData } = useWizard<VertexSetupData>()
  const defaults = useMemo(() => getDefaultVertexModels(), [])
  const [picked, setPicked] = useState<Record<ModelTier, string>>(() => getDefaultVertexModels())
  const [results, setResults] = useState<Record<ModelTier, ModelTestState>>({
    sonnet: 'pending',
    opus: 'pending',
    haiku: 'pending',
  })
  const [picking, setPicking] = useState<PickingState>('summary')

  useEffect(() => {
    let cancelled = false
    setResults((prev) => ({ ...prev, sonnet: 'pending' }))
    void testVertexModel(wizardData, picked.sonnet).then((result) => {
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
    void testVertexModel(wizardData, picked.opus).then((result) => {
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
    void testVertexModel(wizardData, picked.haiku).then((result) => {
      if (!cancelled) setResults((prev) => ({ ...prev, haiku: result }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.haiku])

  if (picking !== 'summary') {
    const tier = picking.picking
    return (
      <TierPicker
        key={tier}
        tier={tier}
        wizardData={wizardData}
        fallback={defaults[tier]}
        current={picked[tier]}
        onPick={(model) => {
          setPicked((prev) => ({ ...prev, [tier]: model }))
          const nextTier = MODEL_TIERS[MODEL_TIERS.indexOf(tier) + 1]
          setPicking(nextTier ? { picking: nextTier } : 'summary')
        }}
        onCancel={() => setPicking('summary')}
      />
    )
  }

  const allSettled = MODEL_TIERS.every((tier) => results[tier] !== 'pending')
  const anyOk = allSettled && MODEL_TIERS.some((tier) => results[tier] !== 'pending' && results[tier].ok)

  const handleChoice = (value: string): void => {
    if (value === 'manual') {
      setPicking({ picking: 'sonnet' })
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
          it even if it is not yet available in your project — Claude Code will fail to connect to Vertex AI until you
          enable the model or pin to one you have.
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
  wizardData,
  fallback,
  current,
  onPick,
  onCancel,
}: {
  tier: ModelTier
  wizardData: VertexSetupData
  fallback: string
  current: string
  onPick: (model: string) => void
  onCancel: () => void
}): React.ReactNode {
  const options = useMemo(() => {
    const list = getVertexModelOptionsForTier(tier)
    if (!list.includes(fallback)) list.push(fallback)
    if (!list.includes(current)) list.push(current)
    return list
  }, [tier, fallback, current])
  const [states, setStates] = useState<Record<string, ModelTestState>>(() =>
    Object.fromEntries(options.map((option) => [option, 'pending' as const])),
  )

  useEffect(() => {
    let cancelled = false
    for (const option of options) {
      void testVertexModel(wizardData, option).then((result) => {
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

  return (
    <WizardDialogLayout subtitle={`Pin ${MODEL_TIER_LABELS[tier]} model`}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Available {MODEL_TIER_LABELS[tier]} versions on Vertex AI · each tested with a one-token request.
        </Text>
        <Select
          key={settled ? 'settled' : 'pending'}
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
          defaultValue={settled ? (isOk(current) ? current : isOk(fallback) ? fallback : sorted.find(isOk)) : current}
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

/** Step 6: review the env block and save it to user settings. */
function ConfirmStep({ onComplete }: { onComplete: (message: string) => void }): React.ReactNode {
  const { goBack, wizardData } = useWizard<VertexSetupData>()
  const [error, setError] = useState<string | null>(null)
  const entries = useMemo(
    () =>
      Object.entries(buildVertexEnv(wizardData)).filter((entry): entry is [string, string] => entry[1] !== undefined),
    [wizardData],
  )

  const handleSave = (): void => {
    const settingsEnv = Object.fromEntries(entries)
    const { error: saveError } = updateSettingsForSource('userSettings', { env: settingsEnv })
    if (saveError) {
      setError(saveError.message)
      return
    }
    logEvent('tengu_vertex_setup_complete', {
      auth_method: String(wizardData.authMethod) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      pinned_models: String(
        Boolean(wizardData.pinSonnet || wizardData.pinOpus || wizardData.pinHaiku),
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      verified: String(
        Boolean(wizardData.verifiedIdentity),
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    const adcHint =
      wizardData.authMethod === 'adc'
        ? ' When your ADC token expires, run `gcloud auth application-default login` — Claude Code picks up refreshed credentials automatically.'
        : ''
    onComplete(`Vertex AI configuration saved to ~/.claude/settings.json.${adcHint}`)
  }

  return (
    <WizardDialogLayout subtitle="Confirm and save">
      <Box flexDirection="column" gap={1}>
        <Text>These will be written to ~/.claude/settings.json under env:</Text>
        <Box flexDirection="column">
          {entries.map(([key, value]) => (
            <Text key={key}>
              {'  '}
              <Text color="suggestion">{key}</Text> = {value}
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
 * Multi-step Google Vertex AI setup wizard shared by the `/setup-vertex` command
 * and the login screen's "3rd-party platform" entry.
 */
export function VertexSetupWizard({ onComplete, onCancel }: Props): React.ReactNode {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const [steps] = useState<WizardStepComponent<VertexSetupData>[]>(() => [
    AuthMethodStep,
    ServiceAccountKeyStep,
    ProjectStep,
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
      title="Set up Google Vertex AI"
      showStepCounter={false}
    />
  )
}
