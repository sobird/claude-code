import type { ReactNode } from 'react'

/** Selectable entry passed to `<Select>`; see `OptionWithDescription` in CustomSelect. */
export type Option = {
  label: ReactNode
  value: string
  description?: string
  dimDescription?: boolean
  disabled?: boolean
}
