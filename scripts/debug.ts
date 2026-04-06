import { defineArgs } from './config';

const result = Bun.spawnSync(
  ['bun', '--inspect-brk=/', ...defineArgs, 'src/entrypoints/cli.tsx', ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

process.exit(result.exitCode);
