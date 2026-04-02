import { define } from './define';

const defineArgs = Object.entries(define()).flatMap(([k, v]) => ['-d', `${k}:${v}`]);

const result = Bun.spawnSync(
  ['bun', ...defineArgs, 'src/entrypoints/cli.tsx', ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

process.exit(result.exitCode);
