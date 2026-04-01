import { rm } from 'node:fs/promises';

import { version } from './package.json';

const outdir = 'dist';

// Clean output directory
await rm(outdir, { recursive: true, force: true });

// Bundle
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  define: {
    'MACRO.VERSION': `"${version}"`,
    'MACRO.BUILD_TIME': `"${new Date().toISOString()}"`,
    'MACRO.ISSUES_EXPLAINER': '"production"',
    'MACRO.PACKAGE_URL': '""',
    'MACRO.README_URL': '""',
    'MACRO.FEEDBACK_CHANNEL': '""',
  },
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
