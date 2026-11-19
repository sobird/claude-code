// Placeholder template-job classifier. stopHooks only calls
// classifyAndWriteState when TEMPLATES is enabled (the flag is off in
// scripts/config.ts), and the jobs state store is not implemented, so this
// resolves without writing anything.

export const classifyAndWriteState: (...args: unknown[]) => Promise<void> = () => Promise.resolve()
