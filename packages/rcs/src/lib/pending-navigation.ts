/**
 * Cross-context hand-off for notification click targets.
 *
 * A service worker cannot always move an existing window or open a new one at a
 * given URL: iOS home-screen apps relaunch at their start URL and ignore the URL
 * passed to `clients.openWindow`, and a cold launch leaves no window to message.
 * The worker records the target here (IndexedDB, shared by the worker and the
 * page) and the app consumes it when it mounts or becomes visible.
 */

const DB_NAME = 'rcs-push'
const STORE = 'pending-navigation'
const KEY = 'url'

function isAppPath(url: unknown): url is string {
  // Reject protocol-relative `//host` as well: Next's router would leave the app.
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Best-effort write; a missing/blocked IndexedDB just loses the hand-off. */
export async function setPendingNavigation(url: string): Promise<void> {
  if (!isAppPath(url)) return
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(url, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}

/** Read and clear the pending target. Only one consumer wins. */
export async function takePendingNavigation(): Promise<string | null> {
  const db = await openDb()
  if (!db) return null
  const value = await new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const request = store.get(KEY)
      let stored: unknown = null
      request.onsuccess = () => {
        stored = request.result
      }
      store.delete(KEY)
      tx.oncomplete = () => resolve(isAppPath(stored) ? stored : null)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  db.close()
  return value
}

/** Drop a hand-off the worker already delivered by other means. */
export async function clearPendingNavigation(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}
