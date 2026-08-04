/**
 * MCP Server route – hosted on Vercel at /api/mcp
 *
 * Auth0 for MCP capabilities demonstrated across the invoice tools:
 *   1. withMcpAuth   — validates Auth0 JWT bearer token on every request
 *   2. FGA           — addInvoice checks writer relation in Auth0 FGA
 *   3. Token Vault   — notifyInvoice exchanges user token for Google token (OBO)
 *   4. RFC 8693 OBO  — payInvoice exchanges invoices.widget.com token for payments.widget.com token
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { AsyncAuthorizationInterrupt } from '@auth0/ai/interrupts'

import { listInvoicesSchema, executeListInvoices } from '@/lib/tools/listInvoices'
import { addInvoiceSchema, executeAddInvoice } from '@/lib/tools/addInvoice'
import { notifyInvoiceSchema, executeNotifyInvoice } from '@/lib/tools/notifyInvoice'
import { payInvoiceSchema, executePayInvoice } from '@/lib/tools/payInvoice'
import type { MCPToolContext } from '@/lib/tools/types'

// ── Auth0 JWT verification ────────────────────────────────────────────────────

const domain = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

// Cache the JWKS remote key set (re-used across warm invocations)
const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `https://${domain}/`,
      audience,
    })
    return {
      token: bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes: ((payload.scope as string) ?? '').split(' ').filter(Boolean),
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch {
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
  if (!sub || !token) return null
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
      async (params) => {
        const result = await executeListInvoices(params)
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
        const mcpCtx = extractCtx(ctx, 'addInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executeAddInvoice(params, mcpCtx)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to add invoice.'
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 3: notifyInvoice ─────────────────────────────────────────────────
    // Authorization: bearer token + Auth0 Token Vault OBO (Google gmail.send +
    //               calendar.events scopes via google-oauth2 connection).
    server.registerTool(
      'notifyInvoice',
      {
        title: 'Notify Invoice',
        description:
          'Send an invoice notification via Gmail email or add a Google Calendar reminder on the ' +
          'due date. Uses Auth0 Token Vault to obtain the user\'s Google credentials (OBO).',
        inputSchema: notifyInvoiceSchema,
      },
      async (params, ctx) => {
        const mcpCtx = extractCtx(ctx, 'notifyInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executeNotifyInvoice(params, mcpCtx)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          // Token Vault interrupt — user must authorize Google scopes and retry
          if (err instanceof AsyncAuthorizationInterrupt) {
            return errorResponse(
              `Authorization pending: ${err.message}. Please approve the Google authorization request and retry.`,
            )
          }
          const msg = err instanceof Error ? err.message : 'Failed to send notification.'
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: payInvoice ────────────────────────────────────────────────────
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
        const mcpCtx = extractCtx(ctx, 'payInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')

        try {
          const result = await executePayInvoice(params, mcpCtx)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to pay invoice.'
          return errorResponse(msg)
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
  required: true,
  requiredScopes: ['tool:list_invoices'],
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
