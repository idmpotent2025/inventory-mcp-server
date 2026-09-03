import { z } from 'zod'
import { getApproval, updateApprovalStatus } from '@/lib/pendingApprovals'
import { addOrgMember } from '@/lib/auth0Management'
import type { MCPToolContext } from './types'

export const approveMemberSchema = z.object({
  requestId: z.string().describe('ID of the pending membership request to approve (e.g. apr-001)'),
})

export type ApproveMemberInput = z.infer<typeof approveMemberSchema>

// ── CIBA: initiate push notification ─────────────────────────────────────────

async function initiateCIBA(
  ctx: MCPToolContext,
  bindingMessage: string,
): Promise<{ authReqId: string; interval: number }> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!
  const audience = process.env.AUTH0_AUDIENCE!

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    login_hint: JSON.stringify({ format: 'iss_sub', iss: `https://${domain}/`, sub: ctx.sub }),
    scope: 'openid',
    audience,
    binding_message: bindingMessage,
    request_expiry: '120',
  })

  console.log('[approveMember] initiating CIBA — sub:', ctx.sub, '| message:', bindingMessage)

  const res = await fetch(`https://${domain}/bc-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[approveMember] CIBA initiation failed — status:', res.status, '| body:', err)
    throw new Error(`CIBA initiation failed: ${err}`)
  }

  const data = (await res.json()) as { auth_req_id: string; expires_in?: number; interval?: number }
  console.log('[approveMember] CIBA initiated — auth_req_id:', data.auth_req_id, '| interval:', data.interval ?? 5)
  return { authReqId: data.auth_req_id, interval: data.interval ?? 5 }
}

// ── CIBA: poll until approved / rejected / expired ────────────────────────────

async function pollForApproval(authReqId: string, intervalSeconds: number): Promise<void> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!

  const deadline = Date.now() + 50_000
  let pollMs = intervalSeconds * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))

    const body = new URLSearchParams({
      grant_type: 'urn:openid:params:grant-type:ciba',
      auth_req_id: authReqId,
      client_id: clientId,
      client_secret: clientSecret,
    })

    const res = await fetch(`https://${domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const data = (await res.json()) as { error?: string; access_token?: string }

    if (res.ok) {
      console.log('[approveMember] CIBA approved')
      return
    }

    const { error } = data
    if (error === 'authorization_pending') {
      console.log('[approveMember] CIBA pending — next poll in', pollMs / 1000, 's')
      continue
    } else if (error === 'slow_down') {
      pollMs += 5_000
      console.log('[approveMember] CIBA slow_down — new interval:', pollMs / 1000, 's')
      continue
    } else if (error === 'access_denied') {
      throw new Error('Authorization denied: the push notification was rejected.')
    } else if (error === 'expired_token') {
      throw new Error('Authorization expired: the push notification was not approved in time.')
    } else {
      throw new Error(`CIBA poll error: ${JSON.stringify(data)}`)
    }
  }

  throw new Error('Authorization timed out: please try again and approve the push notification promptly.')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes the approveMember MCP tool.
 *
 * Authorization:
 *   1. CIBA — sends push notification to the admin's device and polls
 *             Auth0 inline until approved or rejected.
 *   2. Core — marks the request approved and adds the user to the members store.
 */
export async function executeApproveMember(params: ApproveMemberInput, ctx: MCPToolContext) {
  console.log('[approveMember] called with:', { requestId: params.requestId, sub: ctx.sub })

  const approval = getApproval(params.requestId)
  if (!approval) {
    throw new Error(`Pending approval "${params.requestId}" not found.`)
  }
  if (approval.status !== 'pending') {
    throw new Error(`Request "${params.requestId}" has already been ${approval.status}.`)
  }
  if (ctx.orgId && approval.orgId !== ctx.orgId) {
    throw new Error(`Forbidden: request "${params.requestId}" does not belong to your organization.`)
  }

  const { authReqId, interval } = await initiateCIBA(
    ctx,
    `Approve org membership for ${approval.userName} (${params.requestId})`,
  )
  await pollForApproval(authReqId, interval)

  if (!approval.userId) {
    throw new Error(`Request "${params.requestId}" is missing a userId — cannot add to organization.`)
  }
  const orgId = ctx.orgId ?? approval.orgId
  if (!orgId) {
    throw new Error('Forbidden: no organization context — cannot add member to org.')
  }

  await addOrgMember(orgId, approval.userId)
  updateApprovalStatus(params.requestId, 'approved')

  return {
    success: true,
    message: `${approval.userName} has been approved and added to the organization.`,
    userId: approval.userId,
    orgId,
    approval: { ...approval, status: 'approved' },
  }
}
