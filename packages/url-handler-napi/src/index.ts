import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface UrlHandlerNapi {
  waitForUrlEvent: (timeoutMs: number) => null | string;
}

let cachedModule: null | UrlHandlerNapi = null;

function loadModule(): null | UrlHandlerNapi {
  if (cachedModule) {
    return cachedModule;
  }

  // Only works on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    if (process.env.URL_HANDLER_NODE_PATH) {
      // Bundled mode - use the env var path
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cachedModule = require(process.env.URL_HANDLER_NODE_PATH) as UrlHandlerNapi;
    } else {
      // Dev mode - load from vendor directory
      const modulePath = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'url-handler',
        `${process.arch}-darwin`,
        'url-handler.node',
      );
      cachedModule = createRequire(import.meta.url)(modulePath) as UrlHandlerNapi;
    }
    return cachedModule;
  } catch {
    return null;
  }
}

/**
 * Wait for a macOS URL event (Apple Event kAEGetURL).
 *
 * Initializes NSApplication, registers for the URL event, and pumps
 * the event loop for up to `timeoutMs` milliseconds.
 *
 * Returns the URL string if one was received, or null.
 * Only functional on macOS — returns null on other platforms.
 */
export function waitForUrlEvent(timeoutMs: number): null | string {
  const mod = loadModule();
  if (!mod) {
    return null;
  }
  return mod.waitForUrlEvent(timeoutMs);
}
