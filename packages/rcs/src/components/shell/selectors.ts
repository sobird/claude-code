/**
 * Visibility selectors shared by the dashboard and the mobile session drawer.
 *
 * Pure and React-free so they can be unit tested without a DOM. The dashboard
 * maps gateway `owner_user_id` values onto `owner` before calling these, which
 * keeps the rule (members see their own plus unclaimed items; admins see
 * everything) in one place.
 */

export interface OwnedItem {
  owner: string | null
}

export interface Viewer {
  id: string
  role: string
}

function isVisibleTo(item: OwnedItem, user: Viewer): boolean {
  return user.role === 'admin' || item.owner === null || item.owner === user.id
}

/** Sessions a user may see: their own and unclaimed ones, or everything for admins. */
export function selectVisibleSessions<T extends OwnedItem>(sessions: readonly T[], user: Viewer): T[] {
  return sessions.filter((session) => isVisibleTo(session, user))
}

/** Environments a user may see, applying the same ownership rule as sessions. */
export function selectVisibleEnvironments<T extends OwnedItem>(environments: readonly T[], user: Viewer): T[] {
  return environments.filter((environment) => isVisibleTo(environment, user))
}
