import { defineArgs, featureArgs } from './config'

const result = Bun.spawnSync(
  ['bun', ...defineArgs, ...featureArgs, 'src/entrypoints/cli.tsx', ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'] },
)

process.exit(result.exitCode)
