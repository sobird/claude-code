/**
 * Dev-only side-effect module: bridges the Ink host config to the standalone
 * React DevTools frontend, which listens on a WebSocket (localhost:8097).
 *
 * `reconciler.ts` imports this for side effects when NODE_ENV === 'development'.
 * A missing `react-devtools-core` surfaces to that loader as
 * ERR_MODULE_NOT_FOUND, which prints the install hint there.
 *
 * `react-devtools-core` is a browser-oriented backend: its UMD wrapper reaches
 * for `self`, and `connectToDevTools` reads `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * (bailing out when the hook is absent). A terminal process defines neither, so
 * alias them onto globalThis before the import, and install the hook via
 * `initialize()` first — otherwise `connectToDevTools()` is a silent no-op.
 */
// DOM lib types `self`/`window` as `Window`, which `globalThis` can't satisfy;
// the browser-only surface doesn't exist here, so widen to optional props.
const g = globalThis as { self?: unknown; window?: unknown }
g.self ??= globalThis
g.window ??= globalThis

// @ts-expect-error react-devtools-core ships no bundled type declarations
const { initialize, connectToDevTools } = await import('react-devtools-core')

initialize()
connectToDevTools()

export { connectToDevTools, initialize }
