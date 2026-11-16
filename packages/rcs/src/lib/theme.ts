'use client'

/**
 * Theme provider and hook for light/dark/system mode.
 *
 * SSR-safe: the initial render never touches `localStorage` (or `matchMedia`)
 * so server and client markup match. The persisted preference is read in an
 * effect after hydration, then the resolved theme is written to the root
 * element as a `dark` class, matching the `.dark` overrides in `globals.css`.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'theme'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable (private mode, SSR)
  }
  return null
}

function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  root.style.colorScheme = theme
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  const [mounted, setMounted] = useState(false)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Ignore persistence failures; the in-memory preference still applies.
    }
  }, [])

  useEffect(() => {
    const stored = readStoredTheme()
    if (stored) setThemeState(stored)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return undefined
    const resolved: ResolvedTheme = theme === 'system' ? getSystemTheme() : theme
    setResolvedTheme(resolved)
    applyTheme(resolved)
    return undefined
  }, [theme, mounted])

  useEffect(() => {
    if (!mounted || theme !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const next: ResolvedTheme = media.matches ? 'dark' : 'light'
      setResolvedTheme(next)
      applyTheme(next)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme, mounted])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])

  return createElement(ThemeContext.Provider, { value }, children)
}
