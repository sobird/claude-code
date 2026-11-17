/**
 * Turns the CLI's `permission_suggestions` (PermissionUpdate objects) into the
 * buttons the web permission card offers. The card always adds a plain
 * "allow once" option itself; every suggestion becomes one additional button
 * that echoes the original object back as `updatedPermissions`.
 */

export interface PermissionRule {
  toolName: string
  ruleContent?: string
}

export interface PermissionSuggestion {
  type: string
  rules?: PermissionRule[]
  behavior?: 'allow' | 'deny' | 'ask'
  destination?: string
  mode?: string
  directories?: string[]
}

export type PermissionOptionKind =
  | 'allow-once'
  | 'allow-session'
  | 'allow-always'
  | 'accept-edits'
  | 'allow-directories'
  | 'always-deny'
  | 'apply-suggestion'

/** What the web UI sends back for one permission request. */
export interface PermissionDecision {
  approved: boolean
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionSuggestion[]
  message?: string
}

export interface PermissionOption {
  /** Stable React key: the kind plus the suggestion's position. */
  id: string
  kind: PermissionOptionKind
  /** Index into `permission_suggestions`; null for the built-in allow-once. */
  suggestionIndex: number | null
  rules?: PermissionRule[]
  directories?: string[]
  mode?: string
  destination?: string
}

function classify(suggestion: PermissionSuggestion): PermissionOptionKind {
  if (suggestion.type === 'addRules' && suggestion.behavior === 'deny') return 'always-deny'
  if (suggestion.type === 'addRules' && (suggestion.behavior ?? 'allow') === 'allow') {
    return suggestion.destination === 'session' ? 'allow-session' : 'allow-always'
  }
  if (suggestion.type === 'setMode' && suggestion.mode === 'acceptEdits') return 'accept-edits'
  if (suggestion.type === 'addDirectories') return 'allow-directories'
  // replaceRules/removeRules/removeDirectories/other modes: still valid updates,
  // just too varied to label specially. Echo them unchanged.
  return 'apply-suggestion'
}

function dedupeKey(suggestion: PermissionSuggestion): string {
  return JSON.stringify([
    suggestion.type,
    suggestion.rules ?? null,
    suggestion.behavior ?? null,
    suggestion.destination ?? null,
    suggestion.mode ?? null,
    suggestion.directories ?? null,
  ])
}

export interface EditableRule {
  toolName: string
  ruleContent: string
}

/**
 * The one rule a permission card lets the user edit: a single allow rule from
 * an `addRules` suggestion. Multi-rule, deny, and non-rule suggestions keep
 * their original echo-only behavior.
 */
export function editableRule(suggestion: PermissionSuggestion): EditableRule | null {
  if (suggestion.type !== 'addRules' || suggestion.behavior === 'deny') return null
  const rules = suggestion.rules
  if (!rules || rules.length !== 1) return null
  const rule = rules[0]
  if (!rule || typeof rule.toolName !== 'string' || !rule.toolName) return null
  return { toolName: rule.toolName, ruleContent: rule.ruleContent ?? '' }
}

/**
 * Copy of `suggestion` with the unique rule's content replaced (trimmed); an
 * empty value drops `ruleContent`, leaving the bare `Tool` rule. The original
 * object is never mutated.
 */
export function withRuleContent(suggestion: PermissionSuggestion, ruleContent: string): PermissionSuggestion {
  const rules = suggestion.rules
  if (!rules || rules.length !== 1 || !rules[0]) return suggestion
  const trimmed = ruleContent.trim()
  const rule = rules[0]
  return {
    ...suggestion,
    rules: [trimmed ? { ...rule, ruleContent: trimmed } : { toolName: rule.toolName }],
  }
}

/** One allow-once option followed by one option per distinct suggestion. */
export function permissionOptions(suggestions: PermissionSuggestion[] = []): PermissionOption[] {
  const options: PermissionOption[] = [{ id: 'allow-once', kind: 'allow-once', suggestionIndex: null }]
  const seen = new Set<string>()
  suggestions.forEach((suggestion, index) => {
    const key = dedupeKey(suggestion)
    if (seen.has(key)) return
    seen.add(key)
    const kind = classify(suggestion)
    options.push({
      id: `${kind}-${index}`,
      kind,
      suggestionIndex: index,
      ...(suggestion.rules ? { rules: suggestion.rules } : {}),
      ...(suggestion.directories ? { directories: suggestion.directories } : {}),
      ...(suggestion.mode ? { mode: suggestion.mode } : {}),
      ...(suggestion.destination ? { destination: suggestion.destination } : {}),
    })
  })
  return options
}
