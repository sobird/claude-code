export class ComputerExecutor {
  capabilities: {
    screenshotFiltering: 'native' | 'none'
    platform: 'darwin' | 'win32'

    /** Include request_teach_access + teach_step. Read once at server construction. */
    teachMode?: boolean
  } = {
    screenshotFiltering: 'native',
    platform: 'darwin',
  }
}

export interface InstalledApp {
  bundleId: string
  displayName: string
  path: string
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
}

export interface DisplayGeometry {
  width: number
  height: number
  displayId?: number
  originX?: number
  originY?: number
}

export interface FrontmostApp {
  bundleId: string
  displayName: string
}

export type ResolvePrepareCaptureResult = ScreenshotResult

export interface RunningApp {
  bundleId: string
  displayName: string
}
