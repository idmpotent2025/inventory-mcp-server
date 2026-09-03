import { z } from 'zod'
import { removeOrgMember } from '@/lib/auth0Management'
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
  console.log(`[removeMember] ${label} claims:`, JSON.stringify({
    iss: c.iss,
    aud: c.aud,
    sub: c.sub,
    scope: c.scope,
    exp: c.exp,
    azp: c.azp,
  }))
}

export const removeMemberSchema = z.object({
  userId: z.string().describe('Auth0 user ID of the member to remove from the organization (e.g. auth0|abc123)'),
})

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>

/**
 * Exchanges the user's portal access token for an https://api.salesforce.tamirsa.com token
 * using RFC 8693 On-Behalf-Of token exchange.
 *
 * The exchanged token has:
 *   audience: https://api.salesforce.tamirsa.com  permissions: removeMember
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
    audience: 'https://api.salesforce.tamirsa.com',
    scope: 'removeMember',
  })

  console.log('[removeMember] token exchange request — audience: https://api.salesforce.tamirsa.com | scope: removeMember | domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[removeMember] token exchange failed — status:', res.status, '| body:', err)
    throw new Error(`Token exchange failed (https://api.salesforce.tamirsa.com): ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  console.log('[removeMember] token exchange succeeded — status:', res.status)
  return data.access_token
}

/**
 * Executes the removeMember MCP tool.
 *
 * Authorization:
 *   1. RFC 8693 OBO token exchange — user's portal token →
 *      https://api.salesforce.tamirsa.com token with removeMember scope
 *   2. Core — removes the user from the Auth0 organization via Management API
 */
export async function executeRemoveMember(params: RemoveMemberInput, ctx: MCPToolContext) {
  if (!ctx.orgId) {
    throw new Error('Forbidden: no organization context in token. Sign in via an Auth0 organization.')
  }

  logTokenClaims('incoming', ctx.token)

  const adminToken = await exchangeTokenForAdmin(ctx.token)

  logTokenClaims('exchanged (admin)', adminToken)

  await removeOrgMember(ctx.orgId, params.userId)
  return {
    success: true,
    message: `User ${params.userId} has been removed from the organization.`,
    userId: params.userId,
    orgId: ctx.orgId,
  }
}
