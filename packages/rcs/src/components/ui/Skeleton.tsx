import type * as React from 'react'

import { cx } from '@/lib/utils'

import styles from './Skeleton.module.css'

/** Pulsing placeholder block used while gateway data loads. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cx(styles.skeleton, className)} {...props} />
}

export { Skeleton }
