'use client'

import { LayoutGrid, LogOut, Menu, Settings, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'
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

import styles from './navbar.module.css'

interface NavbarProps {
  user: DashboardUser
  signOutAction: () => Promise<void>
}

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={styles.brandIcon}>
      <path d="M10 1L12.2 7.8L19 10L12.2 12.2L10 19L7.8 12.2L1 10L7.8 7.8L10 1Z" fill="var(--color-brand)" />
    </svg>
  )
}

/** Sticky top bar: brand, connection badge, theme toggle, and account menu. */
export function Navbar({ user, signOutAction }: NavbarProps) {
  const { sessions, connection } = useDashboardData()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const t = useTranslations('common')

  const visibleSessions = selectVisibleSessions(toOwnedSessions(sessions), user)
  const initial = (user.name || '?').charAt(0).toUpperCase()
  const roleLabel = t.has('role.' + user.role) ? t('role.' + user.role) : user.role

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <div className={styles.brandRow}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={styles.menuButton}
            onClick={() => setDrawerOpen(true)}
            aria-label={t('openSessions')}
          >
            <Menu className={styles.icon} />
          </Button>

          <Link href="/" className={styles.brand}>
            <BrandMark />
            <span className={styles.truncate}>{t('appName')}</span>
          </Link>
        </div>

        <div className={styles.actions}>
          <div className={styles.statusWrap}>
            <StatusIndicator state={connection} />
          </div>

          <Button
            render={<Link href="/" />}
            variant="ghost"
            size="icon-sm"
            className={styles.dashboardButton}
            aria-label={t('dashboard')}
          >
            <LayoutGrid className={styles.icon} />
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={styles.accountTrigger} />}>
              <span className={styles.avatar}>{initial}</span>
              <span className={styles.accountName}>{user.name || t('account')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={styles.menuContent}>
              <DropdownMenuLabel>
                <div className={styles.menuName}>{user.name || t('account')}</div>
                <div className={styles.menuRole}>{roleLabel}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings" className={styles.menuLink} />}>
                <Settings className={styles.icon} />
                {t('settings')}
              </DropdownMenuItem>
              {user.role === 'admin' ? (
                <DropdownMenuItem render={<Link href="/admin" className={styles.menuLink} />}>
                  <Shield className={styles.icon} />
                  {t('admin')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <form action={signOutAction}>
                <DropdownMenuItem render={<button type="submit" className={styles.signOutButton} />}>
                  <LogOut className={styles.icon} />
                  {t('signOut')}
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className={styles.drawer}>
          <DialogHeader>
            <DialogTitle className={styles.drawerTitle}>{t('sessions')}</DialogTitle>
            <DialogDescription className={styles.drawerDescription}>{t('sessionsDescription')}</DialogDescription>
          </DialogHeader>
          <ScrollArea className={styles.drawerBody}>
            <SessionList sessions={visibleSessions} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </header>
  )
}
