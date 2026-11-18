/** Maximum number of modified files uploaded per turn. */
export const FILE_COUNT_LIMIT = 10000
/** Session-relative directory scanned for files created during the turn. */
export const OUTPUTS_SUBDIR = '.claude-code/outputs'
/** Max concurrent uploads when persisting outputs. */
export const DEFAULT_UPLOAD_CONCURRENCY = 5

export interface FailedPersistence {
  filename: string
  error: string
}

export interface PersistedFile {
  filename: string
  file_id: string
}

export interface FilesPersistedEventData {
  files: PersistedFile[]
  failed: FailedPersistence[]
}

/**
 * Turn start timestamp (epoch ms). Modtimes at or after it count as
 * created/modified during the turn — compared numerically by
 * `findModifiedFiles`.
 */
export type TurnStartTime = number
