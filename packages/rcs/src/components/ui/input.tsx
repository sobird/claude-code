import type * as React from 'react'

import { cx } from '../../lib/utils'

import styles from './input.module.css'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cx(styles.input, className)} {...props} />
}

export { Input }
