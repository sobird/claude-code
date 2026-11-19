// Placeholder for the `claude new|list|reply` template-job CLI. cli.tsx routes
// here only when TEMPLATES is enabled (the flag is off in scripts/config.ts),
// and the jobs infrastructure is not implemented, so this returns immediately.

export const templatesMain: (args: string[]) => Promise<void> = () => Promise.resolve()
