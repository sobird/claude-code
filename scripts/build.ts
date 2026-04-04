import { rm } from 'node:fs/promises';

import { BANNER, define, FEATURES } from './config';

const outdir = 'dist';

// Clean output directory
await rm(outdir, { recursive: true, force: true });

// Bundle
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'node',
  format: 'esm',
  minify: true,
  // compile: true,
  define: define(),
  // features: FEATURES,
  banner: BANNER,
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.info('Build success!', result.outputs);
