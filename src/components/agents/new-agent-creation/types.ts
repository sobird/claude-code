import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'
import type { CustomAgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js'
import type { SettingSource } from '../../../utils/settings/constants.js'
import type { GeneratedAgent } from '../generateAgent.js'

/**
 * Accumulated wizard state. Every field is optional because the wizard starts
 * from `{}` and each step fills in its own slice; steps that depend on an
 * earlier step's value use non-null assertions.
 */
export type AgentWizardData = {
  location?: SettingSource
  method?: 'generate' | 'manual'
  wasGenerated?: boolean
  generationPrompt?: string
  isGenerating?: boolean
  agentType?: string
  whenToUse?: string
  systemPrompt?: string
  selectedTools?: string[]
  selectedModel?: string
  selectedColor?: string
  selectedMemory?: AgentMemoryScope
  generatedAgent?: GeneratedAgent
  finalAgent?: CustomAgentDefinition
}
