import { rm } from 'node:fs/promises';

import { version } from './package.json';

const outdir = 'dist';

// Clean output directory
await rm(outdir, { recursive: true, force: true });

// Bundle
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'node',
  define: {
    'MACRO.VERSION': `"${version}"`,
    'MACRO.BUILD_TIME': `"${new Date().toISOString()}"`,
    'MACRO.ISSUES_EXPLAINER': '"report the issue at https://github.com/sobird/claude-code/issues"',
    'MACRO.FEEDBACK_CHANNEL': '"https://github.com/sobird/claude-code/issues"',
    'MACRO.PACKAGE_URL': '"@sobird/claude-code"',
    'MACRO.README_URL': '"https://code.claude.com/docs/en/overview"',
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
