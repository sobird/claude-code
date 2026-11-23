/** AskUserQuestion 正文：问题清单加从结果文本回填的回答；解析不到问题时返回 null。 */

import { parseAskUserQuestions, type AskUserQuestion, type AskUserQuestionOption } from '@/lib/ask-user-question'
import type { ToolCallData } from '@/lib/session-reducer'

import { formatOutput } from './format'

export interface QuestionViewOption extends AskUserQuestionOption {
  selected: boolean
}

/** 单个问题的展示状态：选项是否被选中，以及选项外的自由文本回答。 */
export interface QuestionViewItem {
  question: string
  header?: string
  multiSelect: boolean
  options: QuestionViewOption[]
  /** 回答里不属于任何选项的部分（CLI 的 “Other” 输入）。 */
  other: string[]
  answered: boolean
}

export interface QuestionViewModel {
  questions: AskUserQuestion[]
  answers: Record<string, string>
  /** 逐题的展示状态，选中/自由文本已在模型里算好。 */
  items: QuestionViewItem[]
  answered: boolean
  output: string
  errored: boolean
}

function questionItem(question: AskUserQuestion, answer: string | undefined): QuestionViewItem {
  const chosen = answer
    ? answer
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : []
  const options = question.options.map((option) => ({ ...option, selected: chosen.includes(option.label) }))
  const other = chosen.filter((part) => !question.options.some((option) => option.label === part))
  return {
    question: question.question,
    header: question.header,
    multiSelect: question.multiSelect,
    options,
    other,
    answered: Boolean(answer),
  }
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
    items: questions.map((question) => questionItem(question, answers[question.question])),
    answered: Object.keys(answers).length > 0,
    output,
    errored: tool.status === 'error',
  }
}
