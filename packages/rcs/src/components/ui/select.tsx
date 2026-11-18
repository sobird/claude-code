'use client'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import type { SelectRootProps } from '@base-ui/react/select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type * as React from 'react'

import { cx } from '../../lib/utils'

import styles from './select.module.css'

function Select<Value = string>({ ...props }: SelectRootProps<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

interface SelectValueProps extends Omit<React.ComponentProps<typeof SelectPrimitive.Value>, 'children'> {
  /** Value-to-label map; only needed when the selected label differs from the value. */
  items?: Record<string, string>
  /** Rendered when nothing is selected. */
  placeholder?: React.ReactNode
}

function SelectValue({ items, placeholder, ...props }: SelectValueProps) {
  const children =
    items || placeholder !== undefined
      ? (value: string | null) => (value == null ? placeholder : (items?.[value] ?? value))
      : undefined
  return (
    <SelectPrimitive.Value data-slot="select-value" {...props}>
      {children}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cx(styles.trigger, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className={styles.icon} />} />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & {
  align?: React.ComponentProps<typeof SelectPrimitive.Positioner>['align']
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        sideOffset={4}
        align={align}
        alignItemWithTrigger={false}
        className={styles.positioner}
      >
        <SelectPrimitive.Popup data-slot="select-content" className={cx(styles.content, className)} {...props}>
          <SelectScrollUpButton />
          <SelectPrimitive.List className={styles.list}>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return <SelectPrimitive.GroupLabel data-slot="select-label" className={cx(styles.label, className)} {...props} />
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cx(styles.item, className)} {...props}>
      <span className={styles.itemIndicator}>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator data-slot="select-separator" className={cx(styles.separator, className)} {...props} />
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      // Base UI overlays the arrows; Radix kept them in flow, so pin them back.
      style={{ position: 'static' }}
      className={cx(styles.scrollButton, className)}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      // Base UI overlays the arrows; Radix kept them in flow, so pin them back.
      style={{ position: 'static' }}
      className={cx(styles.scrollButton, className)}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
