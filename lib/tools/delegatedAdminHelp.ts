import { z } from 'zod'

export const delegatedAdminHelpSchema = z.object({})

export type DelegatedAdminHelpInput = z.infer<typeof delegatedAdminHelpSchema>

const HELP_TEXT = `
TeamAgent — Delegated Admin tools (org_admin role required for all tools except /help):

• listMembers           List portal members. Filter by status: active, inactive, or invited.
                        Auth: JWT + org_admin role.

• inviteMember          Invite a new user to join the portal with a given role (editor or viewer).
                        Auth: JWT + org_admin role + Auth0 FGA (org_admin on org:<orgId>).

• resetPassword         Reset a member's password. Sends a push notification to your device for
                        approval before the reset link is issued.
                        Auth: JWT + org_admin role + CIBA push approval.

• deactivateMember      Deactivate a member account. Uses RFC 8693 token exchange to obtain an
                        admin.widget.com-scoped token before performing the action.
                        Auth: JWT + org_admin role + RFC 8693 OBO token exchange.

• listPendingApprovals  Show all pending membership requests for your organization. Users who
                        have requested access appear here until approved or rejected.
                        Auth: JWT + org_admin role.

• approveUser           Approve a pending membership request (by request ID from listPendingApprovals).
                        Sends a push notification to your device for confirmation, then adds the
                        user to the organization as a viewer.
                        Auth: JWT + org_admin role + CIBA push approval.

• help                  Show this message (no login required).

To use any tool other than help, sign in to the portal with your organization account and ensure
your token carries the org_admin role (https://portal.auth.tamirsa.com/org_role).

Tip: tools that require CIBA will send a push notification to your enrolled Auth0 Guardian device.
If you see "Authorization pending", approve the notification and then retry the same command.
`.trim()

export function executeDelegatedAdminHelp(_params: DelegatedAdminHelpInput): { text: string } {
  return { text: HELP_TEXT }
}
