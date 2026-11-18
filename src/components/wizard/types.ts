import type { ComponentType, Dispatch, ReactNode, SetStateAction } from 'react'

/** Shared state and navigation API exposed to wizard steps via context. */
export type WizardContextValue<T = unknown> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: Dispatch<SetStateAction<T>>
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter?: boolean
}

/** One step in the wizard; rendered by the provider with no required props. */
export type WizardStepComponent<T = unknown> = ComponentType<{ wizardData?: T }>

export type WizardProviderProps<T = unknown> = {
  steps: WizardStepComponent<T>[]
  initialData?: T
  onComplete: (data: T) => void | Promise<void>
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
