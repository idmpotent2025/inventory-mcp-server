import { z } from 'zod'
import { getMember, updateMemberStatus } from '@/lib/members'
import type { MCPToolContext } from './types'

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
  } catch {
    return { error: 'failed to decode' }
  }
}

function logTokenClaims(label: string, jwt: string) {
  const c = decodeJwtClaims(jwt)
  console.log(`[deactivateMember] ${label} claims:`, JSON.stringify({
    iss: c.iss,
    aud: c.aud,
    sub: c.sub,
    scope: c.scope,
    exp: c.exp,
    azp: c.azp,
  }))
}

export const deactivateMemberSchema = z.object({
  memberId: z.string().describe('ID of the member to deactivate (e.g. mbr-002)'),
})

export type DeactivateMemberInput = z.infer<typeof deactivateMemberSchema>

/**
 * Exchanges the user's portal access token for an admin.widget.com token
 * using RFC 8693 On-Behalf-Of token exchange.
 *
 * The exchanged token has:
 *   audience: admin.widget.com  permissions: deactivateMembers
 */
async function exchangeTokenForAdmin(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_ID!
  const clientSecret = process.env.AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'cloud.oktademo.redsalsa.mcpserverclient:access_token',
    audience: 'admin.widget.com',
    scope: 'deactivateMembers',
  })

  console.log('[deactivateMember] token exchange request — audience: admin.widget.com | scope: deactivateMembers | domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[deactivateMember] token exchange failed — status:', res.status, '| body:', err)
    throw new Error(`Token exchange failed (admin.widget.com): ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  console.log('[deactivateMember] token exchange succeeded — status:', res.status)
  return data.access_token
}

/**
 * Executes the deactivateMember MCP tool.
 *
 * Authorization:
 *   1. RFC 8693 OBO token exchange — user's portal token →
 *      admin.widget.com token with deactivateMembers scope
 *   2. Core — marks the member as inactive
 */
export async function executeDeactivateMember(params: DeactivateMemberInput, ctx: MCPToolContext) {
  const member = getMember(params.memberId)
  if (!member) {
    throw new Error(`Member "${params.memberId}" not found.`)
  }
  if (member.status === 'inactive') {
    return {
      success: true,
      message: `Member ${member.name} (${member.id}) is already inactive.`,
      member,
    }
  }

  logTokenClaims('incoming', ctx.token)

  const adminToken = await exchangeTokenForAdmin(ctx.token)

  logTokenClaims('exchanged (admin)', adminToken)

  const updated = updateMemberStatus(params.memberId, 'inactive')
  return {
    success: true,
    message: `Member ${member.name} (${member.id}) has been deactivated.`,
    member: updated,
  }
}
