/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Generate @anthropic-ai/claude-code v2.1.88 source code from `cli.js.map`
 *
 * ```typescript
 * tsx scripts/generate-source-code.ts
 *
 * // or
 * bun run scripts/generate-source-code.ts
 * ```
 *
 * sobird<i@sobird.me> at 2026/04/01 4:45:05 created.
 */

import type { RawSourceMap } from 'source-map';

import fs from 'node:fs';
import path from 'node:path';

import { SourceMapConsumer } from 'source-map';

const __dirname = import.meta.dir;

const rawSourceMap: RawSourceMap = JSON.parse(fs.readFileSync('cli.js.map', 'utf8'));
// .tsx
const sourceMappingURL = '//# sourceMappingURL=data:application/json;charset=utf-8;base64,';

let tsxFileCount = 0;
let srcFileCount = 0;
let srcFileLines = 0;

await SourceMapConsumer.with(rawSourceMap, null, (consumer) => {
  consumer.sources.forEach((file) => {
    const isNodeModulesFile = file.startsWith('../node_modules');
    const filename = path.resolve(__dirname, file);

    fs.mkdirSync(path.dirname(filename), { recursive: true });

    let content = consumer.sourceContentFor(file) ?? '';
    const sourceMappingURLIndex = content.indexOf(sourceMappingURL);

    // 如果文件中存在 sourceMappingURL注释, 则重新解析，并使用解析后的内容覆盖原内容
    if (sourceMappingURLIndex > -1) {
      const sourceMapBase64 = (content.slice(sourceMappingURLIndex + sourceMappingURL.length));
      const sourceMapString = Buffer.from(sourceMapBase64, 'base64').toString('utf8');
      const sourceMap: RawSourceMap = JSON.parse(sourceMapString);

      content = sourceMap.sourcesContent?.[0] ?? '';

      tsxFileCount += 1;

      content = content.replaceAll('"external" ===', 'process.env.USER_TYPE ===');
      content = content.replaceAll('"external" !==', 'process.env.USER_TYPE !==');
      content = content.replaceAll('"production" ===', 'process.env.NODE_ENV ===');
    }

    // 统计源码文件数和代码行数
    if (!isNodeModulesFile) {
      const lineCount = content.split('\n').length;

      srcFileLines += lineCount;
      srcFileCount += 1;
    }

    fs.writeFileSync(filename, content, 'utf-8');
  });

  console.log('srcFileCount', srcFileCount);
  console.log('srcFileLines', srcFileLines);
  console.log('tsxFileCount', tsxFileCount);
});
