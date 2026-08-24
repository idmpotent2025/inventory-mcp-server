/**
 * MCP Server route – hosted on Vercel at /api/mcp
 *
 * Auth0 for MCP capabilities demonstrated across the invoice tools:
 *   1. withMcpAuth   — validates Auth0 JWT bearer token on every request
 *   2. FGA           — addInvoice checks writer relation in Auth0 FGA
 *   3. Token Vault   — notifyInvoice exchanges user token for Google token (OBO)
 *   4. RFC 8693 OBO  — payInvoice exchanges invoices.widget.com token for payments.widget.com token
 *   5. CIBA          — deleteInvoice sends push notification and polls inline (no client retry)
 */

// Allow 55s: deleteInvoice polls Auth0 inline while the user approves the push
export const maxDuration = 55

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'

import { listInvoicesSchema, executeListInvoices } from '@/lib/tools/listInvoices'
import { addInvoiceSchema, executeAddInvoice } from '@/lib/tools/addInvoice'
import { notifyViaGmailSchema, executeNotifyViaGmail } from '@/lib/tools/notifyInvoice'
import { payInvoiceSchema, executePayInvoice } from '@/lib/tools/payInvoice'
import { deleteInvoiceSchema, executeDeleteInvoice } from '@/lib/tools/deleteInvoice'
import { helpSchema, executeHelp } from '@/lib/tools/help'
import type { MCPToolContext } from '@/lib/tools/types'

// ── Auth0 JWT verification ────────────────────────────────────────────────────

const domain = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

console.log('[mcp] config — domain:', domain, '| audience:', audience)

// Cache the JWKS remote key set (re-used across warm invocations)
const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    console.warn('[mcp/verifyToken] no bearer token — rejecting')
    return undefined
  }
  console.log('[mcp/verifyToken] token prefix:', bearerToken.slice(0, 20) + '…')
  try {
    const rawPayload = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64url').toString())
    console.log('[mcp/verifyToken] token iss:', rawPayload.iss, '| aud:', rawPayload.aud)
  } catch { /* ignore decode errors */ }
  console.log('[mcp/verifyToken] checking issuer:', `https://${domain}/`, '| audience:', audience)
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `https://${domain}/`,
      audience,
    })
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean)
    console.log('[mcp/verifyToken] ✓ valid — sub:', payload.sub, '| azp:', payload.azp, '| scopes:', scopes.join(' '))
    return {
      token: bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes,
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch (err) {
    console.error('[mcp/verifyToken] ✗ failed:', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// ── Helper — extract MCPToolContext from handler ctx ─────────────────────────

function extractCtx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  toolName: string,
): MCPToolContext | null {
  const authInfo = ctx.http?.authInfo
  const sub = authInfo?.extra?.['sub'] as string | undefined
  const token = authInfo?.token
  if (!sub || !token) {
    console.warn(`[mcp/${toolName}] extractCtx — missing sub or token, authInfo:`, JSON.stringify(authInfo ?? null))
    return null
  }
  console.log(`[mcp/${toolName}] extractCtx — sub: ${sub} | scopes:`, authInfo?.scopes?.join(' '))
  return { sub, token, toolCallId: `mcp-${toolName}-${Date.now()}` }
}

// ── Standard error response ───────────────────────────────────────────────────

function errorResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  }
}

// ── MCP server definition ─────────────────────────────────────────────────────

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: listInvoices ──────────────────────────────────────────────────
    // Authorization: bearer token only (enforced by withMcpAuth below).
    server.registerTool(
      'listInvoices',
      {
        title: 'List Invoices',
        description: 'List invoices. Optionally filter by status: draft, pending, paid, or overdue.',
        inputSchema: listInvoicesSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/listInvoices] called — params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'listInvoices')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity. Please log in to the portal to use this tool.')

        const result = await executeListInvoices(params)
        console.log('[mcp/listInvoices] returning', Array.isArray(result) ? result.length : '?', 'items')
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      },
    )

    // ── Tool 2: addInvoice ────────────────────────────────────────────────────
    // Authorization: bearer token + FGA writer check on `invoices:default`.
    server.registerTool(
      'addInvoice',
      {
        title: 'Add Invoice',
        description:
          'Create a new invoice with amount, description, and due date (draft status). Requires FGA writer permission on invoices:default.',
        inputSchema: addInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/addInvoice] called — params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'addInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executeAddInvoice(params, mcpCtx)
          console.log('[mcp/addInvoice] success — result:', JSON.stringify(result))
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to add invoice.'
          console.error('[mcp/addInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 3: notifyViaGmail ────────────────────────────────────────────────
    // Authorization: bearer token + Auth0 Token Vault OBO (Google gmail.send
    //               scope via google-oauth2 connection).
    server.registerTool(
      'notifyViaGmail',
      {
        title: 'Notify Via Gmail',
        description:
          'Send an invoice notification email via Gmail. Uses Auth0 Token Vault to obtain ' +
          'the user\'s Google credentials (OBO). Recipient is taken from the email claim ' +
          'in the user\'s access token.',
        inputSchema: notifyViaGmailSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/notifyViaGmail] called — params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'notifyViaGmail')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executeNotifyViaGmail(params, mcpCtx)
          console.log('[mcp/notifyViaGmail] success — result:', JSON.stringify(result))
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'GMAIL_NOT_CONNECTED') {
            console.warn('[mcp/notifyViaGmail] no vaulted Google token — user must connect Gmail')
            return errorResponse(
              'Gmail not connected: please go to Settings → Connect Gmail in the Portal and authorize access, then retry.',
            )
          }
          const msg = err instanceof Error ? err.message : 'Failed to send Gmail notification.'
          console.error('[mcp/notifyViaGmail] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: deleteInvoice ─────────────────────────────────────────────────
    // Authorization: bearer token + CIBA push approval.
    server.registerTool(
      'deleteInvoice',
      {
        title: 'Delete Invoice',
        description:
          'Permanently delete an invoice. Requires CIBA push approval on the user\'s device before deletion.',
        inputSchema: deleteInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/deleteInvoice] called — params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'deleteInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executeDeleteInvoice(params, mcpCtx)
          console.log('[mcp/deleteInvoice] success — result:', JSON.stringify(result))
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to delete invoice.'
          console.error('[mcp/deleteInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 5: payInvoice ────────────────────────────────────────────────────
    // Authorization: bearer token + RFC 8693 OBO token exchange.
    // The user's invoices.widget.com token is exchanged for a
    // payments.widget.com token (payInvoices scope) before processing payment.
    server.registerTool(
      'payInvoice',
      {
        title: 'Pay Invoice',
        description:
          'Mark an invoice as paid. Uses RFC 8693 On-Behalf-Of token exchange to obtain a ' +
          'payments.widget.com token (payInvoices scope) from the user\'s invoices.widget.com token.',
        inputSchema: payInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/payInvoice] called — params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'payInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executePayInvoice(params, mcpCtx)
          console.log('[mcp/payInvoice] success — result:', JSON.stringify(result))
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to pay invoice.'
          console.error('[mcp/payInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )
    // ── Tool 6: help ─────────────────────────────────────────────────────────────
    // No authorization required — returns a plain-text guide to all available tools.
    // Triggered when the user types /help in their AI client.
    server.registerTool(
      'help',
      {
        title: 'Help',
        description:
          'Show all available tools and how to use this agent. ' +
          'Call this tool when the user types /help or asks what this agent can do.',
        inputSchema: helpSchema,
      },
      async (params) => {
        const result = executeHelp(params)
        return {
          content: [{ type: 'text' as const, text: result.text }],
        }
      },
    )
  },
  {
    serverInfo: {
      name: 'invoice-mcp-server',
      version: '1.0.0',
    },
  },
)

// ── Wrap with Auth0 JWT bearer token verification ─────────────────────────────

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: false,
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
