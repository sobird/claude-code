'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { useTheme, type Theme } from '../../lib/theme'
import { Button } from './button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'

const themeOptions: { value: Theme; icon: ReactNode }[] = [
  { value: 'light', icon: <Sun className="h-4 w-4" /> },
  { value: 'dark', icon: <Moon className="h-4 w-4" /> },
  { value: 'system', icon: <Monitor className="h-4 w-4" /> },
]

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const t = useTranslations('common')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8">
          {resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          <span className="sr-only">{t('toggleTheme')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={theme === option.value ? 'bg-accent' : undefined}
          >
            {option.icon}
            <span className="ml-2">{t(`theme.${option.value}`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
