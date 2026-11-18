/** Logical cursor position for a rendered frame (see `Frame.cursor`). */
export type Cursor = {
  x: number
  y: number
  /** False when the cursor should be hidden for this frame. */
  visible: boolean
}
