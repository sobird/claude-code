'use client'

import { useRender } from '@base-ui/react/use-render'

import { cx } from '../../lib/utils'

import styles from './Badge.module.css'

const variantClass = {
  default: styles.variantDefault,
  secondary: styles.variantSecondary,
  destructive: styles.variantDestructive,
  outline: styles.variantOutline,
} as const

type BadgeVariant = keyof typeof variantClass

interface BadgeProps extends useRender.ComponentProps<'span'> {
  variant?: BadgeVariant
}

function Badge({ className, variant = 'default', render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: {
      'data-slot': 'badge',
      className: cx(styles.root, variantClass[variant], className),
      ...props,
    },
  })
}

export { Badge }
