/** AskUserQuestion 正文：问题清单加从结果文本回填的回答；解析不到问题时返回 null。 */

import { parseAskUserQuestions, type AskUserQuestion } from '@/lib/ask-user-question'
import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

export interface QuestionViewModel {
  questions: AskUserQuestion[]
  answers: Record<string, string>
  answered: boolean
  output: string
  errored: boolean
}

/** CLI 的结果文本形如 `"<问题>"="<回答>"`，多选用逗号拼接；属尽力而为的解析。 */
const ANSWER_PAIR = /"([^"]+)"="([^"]*)"/g

function parseAnswers(output: string): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const match of output.matchAll(ANSWER_PAIR)) {
    const question = match[1]
    const answer = match[2]
    if (question !== undefined && answer !== undefined) answers[question] = answer
  }
  return answers
}

export function questionViewModel(tool: ToolCallData): QuestionViewModel | null {
  const questions = parseAskUserQuestions(tool.rawInput)
  if (questions.length === 0) return null
  const output = formatOutput(tool)
  const answers = parseAnswers(output)
  return {
    questions,
    answers,
    answered: Object.keys(answers).length > 0,
    output,
    errored: tool.status === 'error',
  }
}
