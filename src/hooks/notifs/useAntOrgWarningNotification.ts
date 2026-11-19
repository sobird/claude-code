import { useEffect, useRef } from 'react'
import { useNotifications } from 'src/context/notifications.js'
import { getOauthAccountInfo } from 'src/utils/auth.js'

const ORGANIZATION_WARNING_KEY = 'organization-warning'

/**
 * Organizations that should see a one-shot warning when they sign in.
 *
 * Ant-only: this module is lazily required behind `USER_TYPE === 'ant'`, so the
 * literals here never land in external builds (upstream keeps one internal org
 * UUID in excluded-strings). This repository has no internal org IDs to embed,
 * so the list starts empty and the hook is inert here.
 */
export const WARNED_ORGANIZATION_UUIDS: readonly string[] = []

/**
 * Warns when the signed-in OAuth account belongs to a deprecated or otherwise
 * unsupported organization. Runs at most once per session.
 */
export function useAntOrgWarningNotification(): void {
  const { addNotification } = useNotifications()
  const warnedRef = useRef(false)

  useEffect(() => {
    if (warnedRef.current) {
      return
    }

    const orgUUID = getOauthAccountInfo()?.organizationUuid
    if (!orgUUID || !WARNED_ORGANIZATION_UUIDS.includes(orgUUID)) {
      return
    }

    warnedRef.current = true
    addNotification({
      key: ORGANIZATION_WARNING_KEY,
      text: 'You are signed in to an organization that is not supported for Claude Code. Switch to your Anthropic organization.',
      color: 'warning',
      priority: 'high',
    })
  }, [addNotification])
}
