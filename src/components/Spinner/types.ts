/** Stream phase driving the spinner glyph and animation. */
export type SpinnerMode = 'responding' | 'requesting' | 'thinking' | 'tool-use' | 'tool-input'

/** RGB color used for spinner color interpolation. */
export type RGBColor = {
  r: number
  g: number
  b: number
}
