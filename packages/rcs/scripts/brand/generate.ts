#!/usr/bin/env bun
/**
 * Generate the Sobird brand raster assets from the same vector geometry the
 * brand manual documents.
 *
 * Text is converted to outlines with fontkit (the Lora variable font's 600
 * instance) and everything is rasterized by sharp, so no system fonts or
 * browser are required. Fonts are OFL-licensed and fetched from google/fonts
 * on first use into `scripts/brand/.fonts/` (override with RCS_BRAND_FONTS).
 *
 * Usage: bun run brand:generate   (from packages/rcs)
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { create, type Font, type Glyph } from 'fontkit'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const FONTS = path.resolve(process.env.RCS_BRAND_FONTS ?? path.join(HERE, '.fonts'))

const FONT_URLS: Record<string, string> = {
  'Lora.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf',
  'Poppins-Medium.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Medium.ttf',
}

const BRAND = '#c96442'
const CREAM = '#f6f5f2'
const INK = '#1a1917'
const SECOND = '#5e5a54'
const STONE0 = '#efeee9'
const DARK = '#222120'
const DARK_LINE = '#3a3835'
const DARK_ACC = '#7e4533'
const DARK_DOT = '#5a5650'

const CHEVRON = 'M16 19.5 L27.5 32 L16 44.5'
const DOTS = [
  { cx: 32, cy: 44.5 },
  { cx: 40.5, cy: 44.5 },
  { cx: 49, cy: 44.5 },
]
const SPARK =
  'M48.5 18.1 Q49.908 23.092 54.9 24.5 Q49.908 25.908 48.5 30.9 Q47.092 25.908 42.1 24.5 Q47.092 23.092 48.5 18.1 Z'

/** 17 iOS launch-image sizes: width, height, device pixel ratio. */
const DEVICES: Array<[number, number, number]> = [
  [1320, 2868, 3],
  [1206, 2622, 3],
  [1290, 2796, 3],
  [1284, 2778, 3],
  [1179, 2556, 3],
  [1170, 2532, 3],
  [1242, 2688, 3],
  [1242, 2208, 3],
  [1125, 2436, 3],
  [828, 1792, 2],
  [750, 1334, 2],
  [2048, 2732, 2],
  [1668, 2388, 2],
  [1640, 2360, 2],
  [1620, 2160, 2],
  [1536, 2048, 2],
  [1488, 2266, 2],
]

interface IconOptions {
  rounded?: boolean
  contentScale?: number
  withBg?: boolean
  simplified?: boolean
  bg?: string
  fg?: string
}

interface Outline {
  d: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const n = (value: number) => Number(value.toFixed(3))

async function fontFile(name: string): Promise<string> {
  const file = path.join(FONTS, name)
  try {
    await readFile(file)
    return file
  } catch {
    // Missing: download below.
  }
  await mkdir(FONTS, { recursive: true })
  const url = FONT_URLS[name]
  if (!url) throw new Error(`No download URL for ${name}`)
  console.log('fetching', name)
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Failed to fetch ${name}: HTTP ${response.status}`)
  await writeFile(`${file}.part`, Buffer.from(await response.arrayBuffer()))
  await rename(`${file}.part`, file)
  return file
}

async function loadFont(name: string): Promise<Font> {
  return create(await readFile(await fontFile(name)))
}

/** Flatten a font run to one SVG path in font units (y-up). */
function outline(font: Font, text: string, trackingUnits = 0, perCharacter = false): Outline {
  const parts: string[] = []
  let penX = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const add = (glyph: Glyph, dx: number, dy: number) => {
    const box = glyph.bbox
    if (box) {
      minX = Math.min(minX, box.minX + dx)
      minY = Math.min(minY, box.minY + dy)
      maxX = Math.max(maxX, box.maxX + dx)
      maxY = Math.max(maxY, box.maxY + dy)
    }
    const svg = glyph.path.translate(dx, dy).toSVG()
    if (svg) parts.push(svg)
  }

  if (perCharacter) {
    for (const char of text) {
      const run = font.layout(char)
      const glyph = run.glyphs[0]
      if (glyph) add(glyph, penX, 0)
      penX += run.advanceWidth + trackingUnits
    }
  } else {
    const run = font.layout(text)
    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index]
      add(glyph, penX + position.xOffset, position.yOffset)
      penX += position.xAdvance
    })
  }

  if (minX === Infinity) return { d: '', minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { d: parts.join(''), minX, minY, maxX, maxY }
}

/** Place an outline centered on (x, y), or with its left edge on x and baseline on y. */
function placeText(
  run: Outline,
  font: Font,
  size: number,
  color: string,
  at: { x: number; y: number; anchor: 'center' | 'baseline' },
): string {
  const scale = size / font.unitsPerEm
  const tx = at.anchor === 'center' ? at.x - (scale * (run.minX + run.maxX)) / 2 : at.x - scale * run.minX
  const ty = at.anchor === 'center' ? at.y + (scale * (run.minY + run.maxY)) / 2 : at.y
  return `<g transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)} ${n(-scale)})"><path d="${run.d}" fill="${color}"/></g>`
}

function mark(fg: string, contentScale: number, simplified: boolean): string {
  const dots = simplified ? '' : DOTS.map(({ cx, cy }) => `<circle cx="${cx}" cy="${cy}" r="3" fill="${fg}"/>`).join('')
  return `<g transform="translate(32 32) scale(${contentScale}) translate(-32 -32)">
    <path d="${CHEVRON}" fill="none" stroke="${fg}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <path d="${SPARK}" fill="${fg}"/>
  </g>`
}

function iconSvg(size: number, options: IconOptions = {}): string {
  const { rounded = true, contentScale = 1, withBg = true, simplified = false, bg = BRAND, fg = CREAM } = options
  const tile = withBg
    ? `<rect width="64" height="64"${rounded ? ` rx="${n(15 * contentScale)}"` : ''} fill="${bg}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${tile}${mark(fg, contentScale, simplified)}</svg>`
}

async function render(svg: string, relative: string, background?: string): Promise<void> {
  const file = path.join(ROOT, relative)
  await mkdir(path.dirname(file), { recursive: true })
  let image = sharp(Buffer.from(svg))
  if (background) image = image.flatten({ background })
  await writeFile(file, await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer())
  console.log('wrote', relative)
}

async function png(size: number, options: IconOptions = {}): Promise<Buffer> {
  return sharp(Buffer.from(iconSvg(size, options)))
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Multi-size ICO whose entries are PNGs (Vista+), same layout Pillow wrote. */
function ico(frames: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let offset = 6 + 16 * frames.length
  const entries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.data)])
}

function splashSvg(width: number, height: number, dpr: number, font: Font, name: Outline): string {
  const cssWidth = width / dpr
  const iconSize = Math.round(Math.min(0.15 * cssWidth, 120) * dpr)
  const nameSize = Math.round(Math.min(Math.max(0.05 * cssWidth, 16), 28) * dpr)
  const gap = Math.round(iconSize * 0.15)
  const textHeight = ((name.maxY - name.minY) * nameSize) / font.unitsPerEm
  const top = Math.floor((height - (iconSize + gap + textHeight)) / 2)
  const icon = `<g transform="translate(${n((width - iconSize) / 2)} ${top}) scale(${n(iconSize / 64)})">
    <rect width="64" height="64" rx="15" fill="${BRAND}"/>
    ${mark(CREAM, 1, false)}
  </g>`
  const label = placeText(name, font, nameSize, INK, {
    x: width / 2,
    y: top + iconSize + gap + textHeight / 2,
    anchor: 'center',
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${STONE0}"/>
    ${icon}
    ${label}
  </svg>`
}

function ogSvg(wordFont: Font, word: Outline, uiFont: Font, tagline: Outline): string {
  const bars: Array<[number, string]> = [
    [300, DARK_LINE],
    [390, DARK_LINE],
    [220, DARK_ACC],
    [356, DARK_LINE],
    [150, DARK_LINE],
  ]
  const dots = [BRAND, DARK_DOT, DARK_DOT]
    .map((color, i) => `<circle cx="${46 + i * 22}" cy="42" r="6" fill="${color}"/>`)
    .join('')
  const rows = bars
    .map(
      ([width, color], i) => `<rect x="40" y="${100 + i * 46}" width="${width}" height="14" rx="7" fill="${color}"/>`,
    )
    .join('')
  const card = `<g transform="translate(620 115)">
    <rect width="484" height="400" rx="20" fill="${DARK}"/>
    ${dots}
    ${rows}
  </g>`
  const icon = `<g transform="translate(96 190) scale(${n(112 / 64)})">
    <rect width="64" height="64" rx="15" fill="${BRAND}"/>
    ${mark(CREAM, 1, false)}
  </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${CREAM}"/>
    ${icon}
    ${placeText(word, wordFont, 86, INK, { x: 96, y: 394, anchor: 'baseline' })}
    ${placeText(tagline, uiFont, 17, SECOND, { x: 98, y: 440, anchor: 'baseline' })}
    ${card}
  </svg>`
}

async function main(): Promise<void> {
  const wordFont = (await loadFont('Lora.ttf')).getVariation({ wght: 600 })
  const uiFont = await loadFont('Poppins-Medium.ttf')
  const word = outline(wordFont, 'Sobird')
  const tagline = outline(uiFont, 'REMOTE CONTROL FOR CLAUDE CODE', (4.4 * uiFont.unitsPerEm) / 17, true)

  await render(iconSvg(192), 'public/icons/icon-192.png')
  await render(iconSvg(512), 'public/icons/icon-512.png')
  await render(iconSvg(180, { rounded: false }), 'public/icons/apple-icon-180.png', BRAND)
  await render(iconSvg(512, { rounded: false, contentScale: 0.8 }), 'public/icons/icon-maskable-512.png', BRAND)
  await render(iconSvg(512, { withBg: false, contentScale: 0.8 }), 'public/icons/icon-monochrome-512.png')

  await writeFile(
    path.join(ROOT, 'public/favicon.ico'),
    ico([
      { size: 16, data: await png(16, { simplified: true }) },
      { size: 32, data: await png(32) },
      { size: 48, data: await png(48) },
    ]),
  )
  console.log('wrote public/favicon.ico')

  for (const [width, height, dpr] of DEVICES) {
    await render(
      splashSvg(width, height, dpr, wordFont, word),
      `public/icons/splash/light-${width}x${height}.png`,
      STONE0,
    )
  }

  await render(ogSvg(wordFont, word, uiFont, tagline), 'public/brand/og.png', CREAM)
}

await main()
