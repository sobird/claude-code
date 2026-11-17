/**
 * Pure helpers for rendering the AskUserQuestion tool prompt.
 *
 * The CLI asks 1–4 questions, each with a single- or multi-select option list.
 * Answers come back keyed by the question text, with multi-select answers
 * comma-joined (the shape the CLI's `updatedInput.answers` expects).
 */

export interface AskUserQuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface AskUserQuestion {
  question: string
  header?: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export interface AskUserAnswerDraft {
  selected: string[]
  other: string
}

export type AskUserAnswerDrafts = Record<number, AskUserAnswerDraft>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseOption(value: unknown): AskUserQuestionOption | null {
  const record = asRecord(value)
  if (!record || typeof record.label !== 'string' || record.label === '') return null
  return {
    label: record.label,
    description: typeof record.description === 'string' ? record.description : undefined,
    preview: typeof record.preview === 'string' ? record.preview : undefined,
  }
}

/** Extracts the question prompt, tolerating missing or malformed fields. */
export function parseAskUserQuestions(input: Record<string, unknown> | undefined): AskUserQuestion[] {
  const raw = input?.questions
  if (!Array.isArray(raw)) return []

  const questions: AskUserQuestion[] = []
  for (const item of raw) {
    const record = asRecord(item)
    if (!record || typeof record.question !== 'string' || record.question === '') continue
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option) => {
          const parsed = parseOption(option)
          return parsed ? [parsed] : []
        })
      : []
    questions.push({
      question: record.question,
      header: typeof record.header === 'string' ? record.header : undefined,
      options,
      multiSelect: record.multiSelect === true,
    })
  }
  return questions
}

/** True when this permission request is the AskUserQuestion prompt with questions to render. */
export function isAskUserQuestionRequest(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): boolean {
  return toolName?.trim() === 'AskUserQuestion' && parseAskUserQuestions(toolInput).length > 0
}

export function emptyDrafts(questions: AskUserQuestion[]): AskUserAnswerDrafts {
  const drafts: AskUserAnswerDrafts = {}
  questions.forEach((_question, index) => {
    drafts[index] = { selected: [], other: '' }
  })
  return drafts
}

/** Single-select replaces the label; multi-select toggles it. */
export function toggleOption(selected: string[], label: string, multiSelect: boolean): string[] {
  if (!multiSelect) return [label]
  return selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label]
}

/** Comma-joins the chosen labels and any free-text answer, skipping blanks. */
export function answerForQuestion(draft: AskUserAnswerDraft): string {
  const parts = [...draft.selected]
  const other = draft.other.trim()
  if (other) parts.push(other)
  return parts.join(', ')
}

/** Builds the `answers` map keyed by question text, omitting unanswered questions. */
export function buildAskUserAnswers(questions: AskUserQuestion[], drafts: AskUserAnswerDrafts): Record<string, string> {
  const answers: Record<string, string> = {}
  questions.forEach((question, index) => {
    const answer = answerForQuestion(drafts[index] ?? { selected: [], other: '' })
    if (answer) answers[question.question] = answer
  })
  return answers
}

/** The question prompt only advances once every question has an answer. */
export function isAskUserComplete(questions: AskUserQuestion[], drafts: AskUserAnswerDrafts): boolean {
  if (questions.length === 0) return false
  return questions.every((_question, index) => answerForQuestion(drafts[index] ?? { selected: [], other: '' }) !== '')
}
