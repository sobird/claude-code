'use client'

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import type * as React from 'react'

import { cx } from '@/lib/utils'

import styles from './Separator.module.css'

function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cx(styles.root, className)}
      {...props}
    />
  )
}

export { Separator }
