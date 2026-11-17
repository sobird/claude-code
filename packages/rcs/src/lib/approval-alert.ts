/**
 * Title shown in the browser tab while approvals wait in a hidden tab.
 * A leading "(n)" is the convention users already know from chat apps.
 */
export function withPendingApprovalCount(title: string, count: number): string {
  return count > 0 ? `(${count}) ${title}` : title
}
