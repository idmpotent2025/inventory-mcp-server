/**
 * MCP Delegated Admin endpoint — /api/mcp/delegatedAdmin
 *
 * Serves member management tools for the TeamAgent on the portal.
 * All tools require a valid JWT AND the org_admin role in the caller's claims.
 *
 * Auth0 patterns per tool:
 *   listMembers           — JWT + org_admin role check
 *   inviteMember          — JWT + org_admin + FGA org_admin on org:<orgId>
 *   resetPassword         — JWT + org_admin + CIBA push approval
 *   removeMember          — JWT + org_admin + RFC 8693 OBO → https://api.salesforce.tamirsa.com
 *   listPendingApprovals  — JWT + org_admin role check
 *   approveMember         — JWT + org_admin + CIBA push approval
 *
 * Role claim setup: add a Post Login Action in Auth0 that sets:
 *   api.accessToken.setCustomClaim(
 *     'https://portal.auth.tamirsa.com/org_role',
 *     event.organization?.metadata?.role ? [event.organization.metadata.role] : (event.authorization?.roles ?? [])
 *   )
 */

// Allow 55s: resetPassword polls Auth0 inline while the user approves the push
export const maxDuration = 55

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'

import { listMembersSchema, executeListMembers } from '@/lib/tools/listMembers'
import { inviteMemberSchema, executeInviteMember } from '@/lib/tools/inviteMember'
import { resetPasswordSchema, executeResetPassword } from '@/lib/tools/resetPassword'
import { removeMemberSchema, executeRemoveMember } from '@/lib/tools/removeMember'
import { listPendingApprovalsSchema, executeListPendingApprovals } from '@/lib/tools/listPendingApprovals'
import { approveMemberSchema, executeApproveMember } from '@/lib/tools/approveMember'
import { delegatedAdminHelpSchema, executeDelegatedAdminHelp } from '@/lib/tools/delegatedAdminHelp'

const domain = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

// Must match the claim key set by the Auth0 Post Login Action above.
const ROLES_CLAIM = 'https://portal.auth.tamirsa.com/org_role'

console.log('[mcp/delegatedAdmin] config — domain:', domain, '| audience:', audience)

const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    console.warn('[mcp/delegatedAdmin/verifyToken] no bearer token')
    return undefined
  }
  try {
    const rawPayload = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64url').toString())
    console.log('[mcp/delegatedAdmin/verifyToken] iss:', rawPayload.iss, '| aud:', rawPayload.aud)
  } catch { /* ignore */ }
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `https://${domain}/`,
      audience,
    })
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean)
    console.log('[mcp/delegatedAdmin/verifyToken] ✓ sub:', payload.sub, '| scopes:', scopes.join(' '))
    return {
      token: bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes,
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch (err) {
    console.error('[mcp/delegatedAdmin/verifyToken] ✗', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCtx(ctx: any, toolName: string) {
  const authInfo = ctx.http?.authInfo
  const sub = authInfo?.extra?.['sub'] as string | undefined
  const token = authInfo?.token
  const orgId = authInfo?.extra?.['org_id'] as string | undefined
  if (!sub || !token) {
    console.warn(`[mcp/delegatedAdmin/${toolName}] missing sub or token`)
    return null
  }
  console.log(`[mcp/delegatedAdmin/${toolName}] sub: ${sub} | orgId: ${orgId ?? 'none'}`)
  return { sub, token, orgId, toolCallId: `mcp-${toolName}-${Date.now()}` }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireOrgAdmin(ctx: any, toolName: string): boolean {
  const extra = ctx.http?.authInfo?.extra as Record<string, unknown> | undefined
  const roles = ([
    ...(extra?.[ROLES_CLAIM] as string[] ?? []),
    ...(extra?.['roles'] as string[] ?? []),
  ])
  if (!roles.includes('org_admin')) {
    console.warn(`[mcp/delegatedAdmin/${toolName}] caller lacks org_admin role — roles:`, roles)
    return false
  }
  return true
}

function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 0: help — open, no role check ───────────────────────────────────
    server.registerTool(
      'help',
      {
        title: 'Help',
        description:
          'Show all available delegated admin tools and how to use this agent. ' +
          'Call this when the user types /help or asks what this agent can do.',
        inputSchema: delegatedAdminHelpSchema,
      },
      async (params) => {
        const result = executeDelegatedAdminHelp(params)
        return { content: [{ type: 'text' as const, text: result.text }] }
      },
    )

    // ── Tool 1: listMembers — JWT + org_admin ─────────────────────────────────
    server.registerTool(
      'listMembers',
      {
        title: 'List Members',
        description:
          'List portal members. Filter by status: active, inactive, or invited. ' +
          'Requires org_admin role.',
        inputSchema: listMembersSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/listMembers] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'listMembers')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity. Please log in to the portal.')
        if (!requireOrgAdmin(ctx, 'listMembers')) return errorResponse('Forbidden: org_admin role required to manage members.')
        const result = await executeListMembers(params)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      },
    )

    // ── Tool 2: inviteMember — JWT + org_admin + FGA ──────────────────────────
    server.registerTool(
      'inviteMember',
      {
        title: 'Invite Member',
        description:
          'Invite a new member to the portal. ' +
          'Requires org_admin role and FGA org_admin relation on org:<orgId>.',
        inputSchema: inviteMemberSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/inviteMember] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'inviteMember')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        if (!requireOrgAdmin(ctx, 'inviteMember')) return errorResponse('Forbidden: org_admin role required to invite members.')
        try {
          const result = await executeInviteMember(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to invite member.'
          console.error('[mcp/delegatedAdmin/inviteMember] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 3: resetPassword — JWT + org_admin + CIBA push ───────────────────
    server.registerTool(
      'resetPassword',
      {
        title: 'Reset Password',
        description:
          "Reset a member's password. Requires org_admin role and CIBA push approval from your device.",
        inputSchema: resetPasswordSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/resetPassword] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'resetPassword')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        if (!requireOrgAdmin(ctx, 'resetPassword')) return errorResponse('Forbidden: org_admin role required to reset passwords.')
        try {
          const result = await executeResetPassword(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to reset password.'
          console.error('[mcp/delegatedAdmin/resetPassword] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: removeMember — JWT + org_admin + RFC 8693 OBO ────────────────
    server.registerTool(
      'removeMember',
      {
        title: 'Remove Member',
        description:
          'Remove a portal member. Requires org_admin role and RFC 8693 OBO token exchange ' +
          'to obtain a https://api.salesforce.tamirsa.com token (removeMember scope).',
        inputSchema: removeMemberSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/removeMember] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'removeMember')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        if (!requireOrgAdmin(ctx, 'removeMember')) return errorResponse('Forbidden: org_admin role required to remove members.')
        try {
          const result = await executeRemoveMember(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to remove member.'
          console.error('[mcp/delegatedAdmin/removeMember] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 5: listPendingApprovals — JWT + org_admin ────────────────────────
    server.registerTool(
      'listPendingApprovals',
      {
        title: 'List Pending Approvals',
        description:
          'List pending membership requests for your organization. Returns users who have ' +
          'requested to join and are waiting for admin approval. Requires org_admin role.',
        inputSchema: listPendingApprovalsSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/listPendingApprovals] called')
        const mcpCtx = extractCtx(ctx, 'listPendingApprovals')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity. Please log in to the portal.')
        if (!requireOrgAdmin(ctx, 'listPendingApprovals')) return errorResponse('Forbidden: org_admin role required to view pending approvals.')
        try {
          const result = await executeListPendingApprovals(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to list pending approvals.'
          console.error('[mcp/delegatedAdmin/listPendingApprovals] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 6: approveMember — JWT + org_admin + CIBA push ──────────────────
    server.registerTool(
      'approveMember',
      {
        title: 'Approve Member',
        description:
          'Approve a pending membership request, adding the user to the organization. ' +
          'Sends a push notification to your enrolled device for confirmation before the ' +
          'user is granted access. Requires org_admin role.',
        inputSchema: approveMemberSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/delegatedAdmin/approveMember] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'approveMember')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        if (!requireOrgAdmin(ctx, 'approveMember')) return errorResponse('Forbidden: org_admin role required to approve membership requests.')
        try {
          const result = await executeApproveMember(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to approve member.'
          console.error('[mcp/delegatedAdmin/approveMember] error:', msg)
          return errorResponse(msg)
        }
      },
    )
  },
  {
    serverInfo: { name: 'delegated-admin-mcp-server', version: '1.0.0' },
  },
)

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: false,
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
