import { type FileStateCache } from 'src/utils/fileStateCache.ts'
import { type ThemeName } from 'src/utils/theme.ts'

export type Tip = {
  id: string
  content(context?: TipContext): Promise<string>
  cooldownSessions: number
  isRelevant(context?: TipContext): Promise<boolean>
}
export type TipContext = {
  bashTools?: ReadonlySet<string>
  readFileState?: FileStateCache
  theme?: ThemeName
}
