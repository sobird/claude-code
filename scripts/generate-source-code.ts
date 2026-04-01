/**
 * Generate @anthropic-ai/claude-code v2.1.88 source code from `cli.js.map`
 *
 * ```typescript
 * tsx scripts/generate-source-code.ts
 * ```
 *
 * sobird<i@sobird.me> at 2026/04/01 4:45:05 created.
 */

import type { RawSourceMap } from 'source-map';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SourceMapConsumer } from 'source-map';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const rawSourceMap: RawSourceMap = JSON.parse(fs.readFileSync('cli.js.map', 'utf8'));

await SourceMapConsumer.with(rawSourceMap, null, (consumer) => {
  consumer.sources.forEach((file) => {
    const filename = path.resolve(__dirname, file);

    fs.mkdirSync(path.dirname(filename), { recursive: true });

    const content = consumer.sourceContentFor(file);

    if (content !== null) {
      fs.writeFileSync(filename, content, 'utf-8');
    }
  });
});
