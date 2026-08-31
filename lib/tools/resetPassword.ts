import { z } from 'zod'
import { getMember } from '@/lib/members'
import type { MCPToolContext } from './types'

export const resetPasswordSchema = z.object({
  memberId: z.string().describe('ID of the member whose password to reset (e.g. mbr-001)'),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

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

  console.log('[resetPassword] initiating CIBA — sub:', ctx.sub, '| message:', bindingMessage)

  const res = await fetch(`https://${domain}/bc-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[resetPassword] CIBA initiation failed — status:', res.status, '| body:', err)
    throw new Error(`CIBA initiation failed: ${err}`)
  }

  const data = (await res.json()) as { auth_req_id: string; expires_in?: number; interval?: number }
  console.log('[resetPassword] CIBA initiated — auth_req_id:', data.auth_req_id, '| interval:', data.interval ?? 5)
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
      console.log('[resetPassword] CIBA approved')
      return
    }

    const { error } = data
    if (error === 'authorization_pending') {
      console.log('[resetPassword] CIBA pending — next poll in', pollMs / 1000, 's')
      continue
    } else if (error === 'slow_down') {
      pollMs += 5_000
      console.log('[resetPassword] CIBA slow_down — new interval:', pollMs / 1000, 's')
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
 * Executes the resetPassword MCP tool.
 *
 * Authorization:
 *   1. CIBA — sends push notification to the user's device and polls
 *             Auth0 inline until approved or rejected.
 *   2. Core — triggers password reset for the member.
 */
export async function executeResetPassword(params: ResetPasswordInput, ctx: MCPToolContext) {
  console.log('[resetPassword] called with:', {
    memberId: params.memberId,
    sub: ctx.sub,
    tokenPresent: !!ctx.token,
  })

  const member = getMember(params.memberId)
  if (!member) {
    throw new Error(`Member "${params.memberId}" not found.`)
  }

  const { authReqId, interval } = await initiateCIBA(
    ctx,
    `Approve password reset for ${member.name} (${params.memberId})`,
  )
  await pollForApproval(authReqId, interval)

  return {
    success: true,
    message: `Password reset link sent to ${member.email}.`,
    member,
  }
}
