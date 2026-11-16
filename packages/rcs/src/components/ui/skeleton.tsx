import type * as React from 'react'

import { cn } from '../../lib/utils'

/** Pulsing placeholder block used while gateway data loads. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-surface-3/70', className)} {...props} />
}

export { Skeleton }
