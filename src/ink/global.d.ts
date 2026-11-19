import type * as React from 'react'

import type { DOMElement } from './dom.js'

// Ink renders a `ink-box` host element that has no upstream type declaration.
// Declared here so JSX usage is typed (e.g. ScrollBox's ref callback).
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': {
        ref?: React.Ref<DOMElement>
        children?: React.ReactNode
        [key: string]: unknown
      }
      'ink-text': {
        children?: React.ReactNode
        style?: unknown
        textStyles?: unknown
        [key: string]: unknown
      }
      'ink-link': {
        children?: React.ReactNode
        href?: string
        [key: string]: unknown
      }
      'ink-raw-ansi': {
        rawText: string
        rawWidth: number
        rawHeight: number
      }
    }
  }
}
