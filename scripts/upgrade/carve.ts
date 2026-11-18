/**
 * Carve the JS module graph out of an upstream native binary.
 *
 * Upstream stopped publishing `cli.js` with 2.1.113: the npm package is a stub
 * and the real artifact is a platform binary (a Bun single-file executable).
 * The pipeline (inventory/align/extract/verify) only understands JS text, but
 * `bun build --compile` embeds every module source verbatim, each preceded by
 * `// @bun @bytecode` (or `// @bun @bytecode @bun-cjs`) and the release banner.
 *
 * Carving = keep the source of every banner-marked chunk, in graph order, and
 * concatenate. The result parses with the TypeScript parser align uses, so it
 * stands in for `cli.js` for the whole pipeline.
 *
 * Why the banner is the marker's tell: the bare `// @bun @bytecode` string also
 * occurs in Bun's own string tables (transpiler error text, templates), where
 * it is not followed by the banner. Requiring the banner line right after the
 * marker drops those decoys; on 2.1.327 it rejects exactly two.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { CarveResult } from './types'

const MARKER = '// @bun @bytecode'
const MARKER_RE = /^\/\/ @bun @bytecode(?: @bun-cjs)?$/
const BANNER_PREFIX = '// (c) Anthropic PBC'
const VERSION_RE = /^\/\/ Version: (\d+\.\d+\.\d+)$/

type Chunk = { bodyStart: number; version: string }

/** Line text between `start` and the next `\n` (offsets are byte offsets). */
function lineAt(data: Buffer, start: number): { text: string; eol: number } {
  const eol = data.indexOf(0x0a, start)
  if (eol === -1) throw new Error(`unterminated line at byte ${start}`)
  return { text: data.toString('utf8', start, eol), eol }
}

/** Real chunks only: marker line, then the banner, then a Version line. */
function readChunk(data: Buffer, markerStart: number): Chunk | null {
  const marker = lineAt(data, markerStart)
  if (!MARKER_RE.test(marker.text)) return null
  const bannerStart = marker.eol + 1
  const banner = lineAt(data, bannerStart)
  if (!banner.text.startsWith(BANNER_PREFIX)) return null
  // Banner is c-line, blank line, Version line; the source follows at once.
  const versionLine = lineAt(data, banner.eol + 1) // blank line
  const version = lineAt(data, versionLine.eol + 1)
  const match = VERSION_RE.exec(version.text)
  if (!match) return null
  return { bodyStart: version.eol + 1, version: match[1] }
}

function findMarkers(data: Buffer): Array<{ start: number; chunk: Chunk }> {
  const found: Array<{ start: number; chunk: Chunk }> = []
  let offset = 0
  while (true) {
    const start = data.indexOf(MARKER, offset)
    if (start === -1) return found
    // No line-start test: Bun pads each chunk with binary, so a real marker is
    // often not preceded by `\n`. readChunk rejects decoys by requiring the
    // marker line to match exactly and the banner to follow.
    const chunk = readChunk(data, start)
    if (chunk) found.push({ start, chunk })
    offset = start + MARKER.length
  }
}

export async function carveNativeBundle(opts: { binaryPath: string; outPath: string }): Promise<CarveResult> {
  const data = await readFile(opts.binaryPath)
  const markers = findMarkers(data)
  if (markers.length === 0) {
    throw new Error(
      `${opts.binaryPath}: no embedded chunks found — is this a Bun single-file binary built with the release banner?`,
    )
  }

  const versions = [...new Set(markers.map((marker) => marker.chunk.version))]
  if (versions.length > 1) {
    throw new Error(`${opts.binaryPath}: mixed embedded versions ${versions.join(', ')}`)
  }

  const bodies: Buffer[] = []
  for (let i = 0; i < markers.length; i++) {
    const bodyStart = markers[i].chunk.bodyStart
    const bodyEnd = i + 1 < markers.length ? markers[i + 1].start : data.length
    let body = data.subarray(bodyStart, bodyEnd)
    // Trailing binary after the last chunk ends at the first NUL. JS sources
    // never contain one, so this cannot clip real code.
    const nul = body.indexOf(0)
    if (nul !== -1) body = body.subarray(0, nul)
    bodies.push(Buffer.from(body.toString('utf8').trim() + '\n', 'utf8'))
  }

  const carved = Buffer.concat(bodies)
  await mkdir(dirname(opts.outPath), { recursive: true })
  await writeFile(opts.outPath, carved)

  return {
    version: versions[0],
    chunks: markers.length,
    bytes: carved.length,
    binarySha256: createHash('sha256').update(data).digest('hex'),
  }
}
