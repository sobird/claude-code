/** Jupyter `.ipynb` cell type. */
export type NotebookCellType = 'code' | 'markdown' | 'raw'

/** Image output embedded in a notebook cell. */
export type NotebookOutputImage = {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

/** Raw output entry as serialized in the `.ipynb` file. */
export type NotebookCellOutput =
  | {
      output_type: 'stream'
      text?: string | string[]
    }
  | {
      output_type: 'execute_result' | 'display_data'
      data?: Record<string, string | string[] | undefined>
    }
  | {
      output_type: 'error'
      ename: string
      evalue: string
      traceback: string[]
    }

/** Raw cell as serialized in the `.ipynb` file. */
export type NotebookCell = {
  id?: string
  cell_type: NotebookCellType
  source: string | string[]
  metadata?: Record<string, unknown>
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
}

/** Parsed `.ipynb` document (only the fields this codebase reads). */
export type NotebookContent = {
  cells: NotebookCell[]
  metadata: {
    language_info?: {
      name?: string
    }
  }
  nbformat: number
  nbformat_minor: number
}

/** Processed (truncated / decoded) cell output for tool results. */
export type NotebookCellSourceOutput = {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text: string
  image?: NotebookOutputImage
}

/** Processed cell used when building notebook tool results. */
export type NotebookCellSource = {
  cellType: NotebookCellType
  source: string
  execution_count?: number
  cell_id: string
  language?: string
  outputs?: NotebookCellSourceOutput[]
}
