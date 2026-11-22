'use client'

import { LayoutGrid, LogOut, Menu, Settings, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { StatusIndicator } from '@/components/ui/ConnectionStatus'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

import { useDashboardData } from './DashboardData'
import { selectVisibleSessions } from './selectors'
import { SessionList } from './SessionList'
import { toOwnedSessions, type DashboardUser } from './types'

import styles from './Navbar.module.css'

interface NavbarProps {
  user: DashboardUser
  signOutAction: () => Promise<void>
}

/** Brand mark: a prompt chevron, three in-progress dots, and a remote spark. */
function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true" className={styles.brandIcon}>
      <rect width="64" height="64" rx="15" fill="var(--color-brand)" />
      <path
        d="M16 19.5 L27.5 32 L16 44.5"
        fill="none"
        stroke="#f6f5f2"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="44.5" r="3" fill="#f6f5f2" />
      <circle cx="40.5" cy="44.5" r="3" fill="#f6f5f2" />
      <circle cx="49" cy="44.5" r="3" fill="#f6f5f2" />
      <path
        d="M48.5 18.1 Q49.908 23.092 54.9 24.5 Q49.908 25.908 48.5 30.9 Q47.092 25.908 42.1 24.5 Q47.092 23.092 48.5 18.1 Z"
        fill="#f6f5f2"
      />
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
  const roleLabel = user.role === 'admin' || user.role === 'member' ? t(`role.${user.role}`) : user.role

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
