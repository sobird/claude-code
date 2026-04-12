import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ModifierKey = 'shift' | 'command' | 'control' | 'option'
interface ModifiersNapi {
  getModifiers: () => ModifierKey[]
  isModifierPressed: (modifier: ModifierKey) => boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))

let cachedModule: ModifiersNapi | null = null

function loadModule(): ModifiersNapi | null {
  if (cachedModule) {
    return cachedModule
  }

  // Only works on macOS
  if (process.platform !== 'darwin') {
    return null
  }

  try {
    if (process.env.MODIFIERS_NODE_PATH) {
      // Bundled mode - use the env var path
      cachedModule = require(process.env.MODIFIERS_NODE_PATH)
    } else {
      const platformDir = `${process.arch}-${process.platform}`
      const candidates = [
        // 本地编译出的
        `build/Release/modifiers.node`,
        `build/Debug/modifiers.node`,
        `../build/Release/modifiers.node`,
        `../build/Debug/modifiers.node`,
        // 预编译好的
        `vendor/modifiers-napi/${platformDir}/modifiers.node`,
        `../vendor/modifiers-napi/${platformDir}/modifiers.node`,
        `../../vendor/modifiers-napi/${platformDir}/modifiers.node`,
        `../../../vendor/modifiers-napi/${platformDir}/modifiers.node`,
      ]

      for (const candidate of candidates) {
        try {
          cachedModule = createRequire(import.meta.url)(join(__dirname, candidate))
          return cachedModule
        } catch {
          // try next
        }
      }
    }
    return cachedModule
  } catch {
    return null
  }
}

export function getModifiers(): ModifierKey[] {
  const mod = loadModule()
  if (!mod) {
    return []
  }
  return mod.getModifiers()
}

export function isModifierPressed(modifier: ModifierKey): boolean {
  const mod = loadModule()
  if (!mod) {
    return false
  }
  return mod.isModifierPressed(modifier)
}

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early (e.g., at startup) to avoid delay on first use.
 */
export function prewarm(): void {
  // Just call loadModule to cache it
  loadModule()
}
