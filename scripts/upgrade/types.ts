export type Status =
  | 'already-present'
  | 'ported'
  | 'approximated'
  | 'ignored-dependency'
  | 'retained-internal'
  | 'unresolved'

export type CommandEntry = { type: 'local' | 'local-jsx' | 'prompt'; name: string }

export type CarveResult = {
  version: string
  chunks: number
  bytes: number
  binarySha256: string
}

export type Inventory = {
  version: string | null
  sha256: string
  bytes: number
  commands: CommandEntry[]
  envVars: string[]
  cliFlags: string[]
  strings: string[]
}

export type AlignNode = {
  target: { start: number; end: number; kind: string; name?: string }
  reference?: { start: number; end: number }
  source?: { file: string; line: number; name?: string }
  confidence: 'high' | 'medium' | 'low'
  classification: 'matched' | 'changed' | 'new' | 'ignored-dependency' | 'unattributed'
}

export type AlignResult = {
  source: { reference: string; target: string; map: boolean }
  nodes: AlignNode[]
}

export type StatusEntry = { id: string; kind: string; status: Status; evidence: string[]; notes?: string }

export type StatusLedger = { source: { reference: string; target: string }; entries: StatusEntry[] }

export type VerifyReport = {
  ok: boolean
  counts: Record<Status, number>
  missingInSrc: string[]
  unexpectedInSrc: string[]
  unregistered: string[]
  unresolved: string[]
}

export type ProbeScenario = {
  args: string[]
  env?: Record<string, string>
  stdin?: string | null
  breakpoints: Array<{ script: string; line: number; column: number; label: string }>
  capture: Array<'args' | 'return' | 'fn.toString' | string>
}

export type ProbeTrace = {
  label: string
  frames: Array<{ fn: string; line: number; column: number }>
  captured: Array<Record<string, unknown>>
}
