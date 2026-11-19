import stripAnsiPackage from 'strip-ansi'

type BunGlobal = { stripANSI?: (input: string) => string }

// Bun ships a native ANSI stripper that beats the JS regex on the render hot
// path. Use it when available; otherwise fall back to the `strip-ansi` package.
const bun = (globalThis as { Bun?: BunGlobal }).Bun
const nativeStripAnsi = typeof bun?.stripANSI === 'function' ? bun.stripANSI : null

export const stripAnsi: (input: string) => string = nativeStripAnsi ?? stripAnsiPackage
