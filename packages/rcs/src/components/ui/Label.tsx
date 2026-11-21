import type * as React from 'react'

import { cx } from '@/lib/utils'

import styles from './Label.module.css'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- generic primitive; call sites associate via htmlFor
    <label data-slot="label" className={cx(styles.label, className)} {...props} />
  )
}

export { Label }
