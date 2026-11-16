import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Format epoch seconds for display; empty input renders an empty string. */
export function formatTime(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
}
