import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { carveNativeBundle } from '../carve'

const BANNER = '// (c) Anthropic PBC. All rights reserved.'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `carve-${process.pid}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One embedded chunk: marker line, banner, blank line, Version line, body. */
function chunk(version: string, body: string, opts: { cjs?: boolean } = {}): Buffer {
  const marker = opts.cjs ? '// @bun @bytecode @bun-cjs' : '// @bun @bytecode'
  return Buffer.from(`${marker}\n${BANNER}\n\n// Version: ${version}\n${body}\n`, 'utf8')
}

async function carveBytes(data: Buffer) {
  const dir = tempDir()
  const binaryPath = join(dir, 'claude')
  const outPath = join(dir, 'carved.js')
  writeFileSync(binaryPath, data)
  const result = await carveNativeBundle({ binaryPath, outPath })
  return { result, carved: readFileSync(outPath), binaryPath }
}

test('concatenates banner-marked chunks in order, trimming binary padding', async () => {
  const binary = Buffer.concat([
    Buffer.from('\x00\x01 binary preamble\n'),
    chunk('1.0.0', 'const one = 1'),
    Buffer.from('\n\x00\x00\x00'),
    chunk('1.0.0', 'exports.two = 2', { cjs: true }),
    Buffer.from('\x00\xff\xfe trailing binary'),
  ])
  const { result, carved } = await carveBytes(binary)

  // The body of each chunk runs to the next marker (or EOF) and is cut at the
  // first NUL, so both padding regions are dropped.
  expect(carved.toString('utf8')).toBe('const one = 1\nexports.two = 2\n')
  expect(result).toEqual({
    version: '1.0.0',
    chunks: 2,
    bytes: carved.length,
    binarySha256: createHash('sha256').update(binary).digest('hex'),
  })
})

test('ignores marker strings that are not followed by the release banner', async () => {
  const binary = Buffer.concat([
    // Decoy from Bun's own string tables: marker mid-line with trailing text.
    Buffer.from('transpiler error: // @bun @bytecode is not valid here\n'),
    // Decoy: exact marker line, but the next line is not the banner.
    Buffer.from('// @bun @bytecode\n// some other comment\nnot source\n'),
    chunk('2.0.0', 'export const real = true'),
  ])
  const { result, carved } = await carveBytes(binary)

  expect(result.chunks).toBe(1)
  expect(result.version).toBe('2.0.0')
  expect(carved.toString('utf8')).toBe('export const real = true\n')
})

test('keeps a marker line inside a chunk body when no banner follows it', async () => {
  const body = 'const s = 1\n// @bun @bytecode\nconst t = 2'
  const { result, carved } = await carveBytes(chunk('1.2.3', body))

  expect(result.chunks).toBe(1)
  expect(carved.toString('utf8')).toBe(`${body}\n`)
})

test('fails when the binary embeds no banner-marked chunks', async () => {
  const dir = tempDir()
  const binaryPath = join(dir, 'claude')
  writeFileSync(binaryPath, 'plain text // @bun @bytecode\nno banner\n')
  await expect(carveNativeBundle({ binaryPath, outPath: join(dir, 'out.js') })).rejects.toThrow(
    /no embedded chunks found/,
  )
})

test('fails on mixed embedded versions', async () => {
  const binary = Buffer.concat([chunk('1.0.0', 'a'), chunk('1.0.1', 'b')])
  await expect(carveBytes(binary)).rejects.toThrow(/mixed embedded versions 1\.0\.0, 1\.0\.1/)
})
