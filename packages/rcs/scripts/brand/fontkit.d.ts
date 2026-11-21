// fontkit ships no types of its own; declare only the surface this generator uses.
declare module 'fontkit' {
  export interface BBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }

  export interface Path {
    toSVG(): string
    translate(x: number, y: number): Path
  }

  export interface Glyph {
    path: Path
    bbox: BBox | null
  }

  export interface GlyphPosition {
    xAdvance: number
    yAdvance: number
    xOffset: number
    yOffset: number
  }

  export interface GlyphRun {
    glyphs: Glyph[]
    positions: GlyphPosition[]
    advanceWidth: number
    bbox: BBox
  }

  export interface Font {
    unitsPerEm: number
    variationAxes: Record<string, { name: string; min: number; default: number; max: number }>
    getVariation(axes: Record<string, number>): Font
    layout(text: string): GlyphRun
  }

  export function create(buffer: Uint8Array): Font
}
