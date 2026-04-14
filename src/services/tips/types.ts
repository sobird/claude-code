import { BashTool } from 'src/tools/BashTool/BashTool.tsx'
import { type FileStateCache } from 'src/utils/fileStateCache.ts'
import { type ThemeName } from 'src/utils/theme.ts'

export type Tip = {
  id: string
  content(context: TipContext): Promise<string>
  cooldownSessions: number
  isRelevant(context?: TipContext): Promise<boolean>
}
export type TipContext = {
  bashTools: Map<string, typeof BashTool>
  readFileState: FileStateCache
  theme: ThemeName
}
