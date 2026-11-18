'use client'

import { useRender } from '@base-ui/react/use-render'

import { cx } from '../../lib/utils'

import styles from './Button.module.css'

const variantClass = {
  default: styles.variantDefault,
  destructive: styles.variantDestructive,
  outline: styles.variantOutline,
  secondary: styles.variantSecondary,
  ghost: styles.variantGhost,
  link: styles.variantLink,
  brand: styles.variantBrand,
  surface: styles.variantSurface,
} as const

const sizeClass = {
  default: styles.sizeDefault,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
  'icon-sm': styles.sizeIconSm,
  'icon-lg': styles.sizeIconLg,
} as const

type ButtonVariant = keyof typeof variantClass
type ButtonSize = keyof typeof sizeClass

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

function Button({ className, variant = 'default', size = 'default', render, ...props }: ButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      'data-slot': 'button',
      className: cx(styles.root, variantClass[variant], sizeClass[size], className),
      ...props,
    },
  })
}

export { Button }
