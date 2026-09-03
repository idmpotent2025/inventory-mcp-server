import { z } from 'zod'
import { listPendingApprovals as queryStore } from '@/lib/pendingApprovals'
import type { MCPToolContext } from './types'

export const listPendingApprovalsSchema = z.object({}).describe(
  'No parameters required — the org is inferred from the caller\'s JWT org_id claim.',
)

export type ListPendingApprovalsInput = z.infer<typeof listPendingApprovalsSchema>

export async function executeListPendingApprovals(
  _params: ListPendingApprovalsInput,
  ctx: MCPToolContext,
) {
  if (!ctx.orgId) {
    throw new Error(
      'Forbidden: no organization context in token. Sign in via an Auth0 organization.',
    )
  }

  const approvals = queryStore(ctx.orgId, 'pending')

  return {
    orgId: ctx.orgId,
    pending: approvals,
    count: approvals.length,
  }
}
