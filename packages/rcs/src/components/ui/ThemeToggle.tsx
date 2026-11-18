'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { useTheme, type Theme } from '../../lib/theme'
import { Button } from './Button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu'

import styles from './ThemeToggle.module.css'

const themeOptions: { value: Theme; icon: ReactNode }[] = [
  { value: 'light', icon: <Sun /> },
  { value: 'dark', icon: <Moon /> },
  { value: 'system', icon: <Monitor /> },
]

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const t = useTranslations('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className={styles.trigger} />}>
        {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
        <span className={styles.srOnly}>{t('toggleTheme')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={theme === option.value ? styles.selected : undefined}
          >
            {option.icon}
            <span className={styles.itemLabel}>{t(`theme.${option.value}`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
