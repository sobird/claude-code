'use client'

import { LayoutGrid, LogOut, Menu, Settings, Shield } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Button } from '../ui/button'
import { StatusIndicator } from '../ui/connection-status'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { ScrollArea } from '../ui/scroll-area'
import { ThemeToggle } from '../ui/theme-toggle'
import { useDashboardData } from './dashboard-data'
import { selectVisibleSessions } from './selectors'
import { SessionList } from './session-list'
import { toOwnedSessions, type DashboardUser } from './types'

interface NavbarProps {
  user: DashboardUser
  signOutAction: () => Promise<void>
}

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-shrink-0">
      <path d="M10 1L12.2 7.8L19 10L12.2 12.2L10 19L7.8 12.2L1 10L7.8 7.8L10 1Z" fill="var(--color-brand)" />
    </svg>
  )
}

/** Sticky top bar: brand, connection badge, theme toggle, and account menu. */
export function Navbar({ user, signOutAction }: NavbarProps) {
  const { sessions, connection } = useDashboardData()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const visibleSessions = selectVisibleSessions(toOwnedSessions(sessions), user)
  const initial = (user.name || '?').charAt(0).toUpperCase()

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface-1">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open sessions"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <Link
            href="/"
            className="flex items-center gap-2 font-display text-base font-semibold text-text-primary no-underline sm:text-lg"
          >
            <BrandMark />
            <span className="truncate">Remote Control</span>
          </Link>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <div className="hidden items-center rounded-md px-2 py-1 sm:flex">
            <StatusIndicator state={connection} />
          </div>

          <Button asChild variant="ghost" size="icon-sm" className="hidden md:inline-flex" aria-label="Dashboard">
            <Link href="/">
              <LayoutGrid className="h-4 w-4" />
            </Link>
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 px-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                  {initial}
                </span>
                <span className="hidden max-w-28 truncate sm:inline">{user.name || 'Account'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="truncate text-sm font-medium text-text-primary">{user.name || 'Account'}</div>
                <div className="text-xs font-normal capitalize text-text-muted">{user.role}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings" className="w-full no-underline">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              {user.role === 'admin' ? (
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="w-full no-underline">
                    <Shield className="h-4 w-4" />
                    Admin
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <form action={signOutAction}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="max-h-[80vh] overflow-hidden bg-surface-1 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-semibold text-text-primary">Sessions</DialogTitle>
            <DialogDescription className="text-sm text-text-muted">
              Open a session or start a new one from the dashboard.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <SessionList sessions={visibleSessions} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </header>
  )
}
