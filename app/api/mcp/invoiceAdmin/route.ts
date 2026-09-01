/**
 * MCP Invoice Admin endpoint — /api/mcp/invoiceAdmin
 *
 * Serves invoice tools for the TaskAgent on the portal.
 * Auth0 patterns: JWT bearer, FGA, Token Vault, RFC 8693 OBO, CIBA push.
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
import { rollbackDeleteInvoiceSchema, executeRollbackDeleteInvoice } from '@/lib/tools/rollbackDelete'

const domain = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

console.log('[mcp/invoiceAdmin] config — domain:', domain, '| audience:', audience)

const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    console.warn('[mcp/invoiceAdmin/verifyToken] no bearer token')
    return undefined
  }
  try {
    const rawPayload = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64url').toString())
    console.log('[mcp/invoiceAdmin/verifyToken] iss:', rawPayload.iss, '| aud:', rawPayload.aud)
  } catch { /* ignore */ }
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `https://${domain}/`,
      audience,
    })
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean)
    console.log('[mcp/invoiceAdmin/verifyToken] ✓ sub:', payload.sub, '| scopes:', scopes.join(' '))
    return {
      token: bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes,
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch (err) {
    console.error('[mcp/invoiceAdmin/verifyToken] ✗', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCtx(ctx: any, toolName: string) {
  const authInfo = ctx.http?.authInfo
  const sub = authInfo?.extra?.['sub'] as string | undefined
  const token = authInfo?.token
  if (!sub || !token) {
    console.warn(`[mcp/invoiceAdmin/${toolName}] missing sub or token`)
    return null
  }
  console.log(`[mcp/invoiceAdmin/${toolName}] sub: ${sub}`)
  return { sub, token, toolCallId: `mcp-${toolName}-${Date.now()}` }
}

function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: help ─────────────────────────────────────────────────────────
    server.registerTool(
      'help',
      {
        title: 'Help',
        description:
          'Show all available invoice tools and how to use this agent. ' +
          'Call this when the user types /help or asks what this agent can do.',
        inputSchema: helpSchema,
      },
      async (params) => {
        const result = executeHelp(params)
        return { content: [{ type: 'text' as const, text: result.text }] }
      },
    )

    // ── Tool 2: listInvoices — JWT bearer ─────────────────────────────────────
    server.registerTool(
      'listInvoices',
      {
        title: 'List Invoices',
        description: 'List invoices. Optionally filter by status: draft, pending, paid, or overdue.',
        inputSchema: listInvoicesSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/invoiceAdmin/listInvoices] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'listInvoices')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity. Please log in to the portal.')
        const result = await executeListInvoices(params)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      },
    )

    // ── Tool 3: addInvoice — JWT + FGA ────────────────────────────────────────
    server.registerTool(
      'addInvoice',
      {
        title: 'Add Invoice',
        description:
          'Create a new invoice with amount, description, and due date (draft status). ' +
          'Requires FGA writer permission on invoices:invoiceA.',
        inputSchema: addInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/invoiceAdmin/addInvoice] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'addInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeAddInvoice(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to add invoice.'
          console.error('[mcp/invoiceAdmin/addInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: notifyViaGmail — JWT + Token Vault ────────────────────────────
    server.registerTool(
      'notifyViaGmail',
      {
        title: 'Notify Via Gmail',
        description:
          "Send an invoice notification email via Gmail. Uses Auth0 Token Vault to obtain " +
          "the user's Google credentials (OBO).",
        inputSchema: notifyViaGmailSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/invoiceAdmin/notifyViaGmail] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'notifyViaGmail')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeNotifyViaGmail(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'GMAIL_NOT_CONNECTED') {
            return errorResponse(
              'Gmail not connected: please go to Settings → Connect Gmail in the Portal and authorize access, then retry.',
            )
          }
          const msg = err instanceof Error ? err.message : 'Failed to send Gmail notification.'
          console.error('[mcp/invoiceAdmin/notifyViaGmail] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 5: deleteInvoice — JWT + CIBA push ───────────────────────────────
    server.registerTool(
      'deleteInvoice',
      {
        title: 'Delete Invoice',
        description:
          "Permanently delete an invoice. Requires CIBA push approval on the user's device before deletion.",
        inputSchema: deleteInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/invoiceAdmin/deleteInvoice] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'deleteInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeDeleteInvoice(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to delete invoice.'
          console.error('[mcp/invoiceAdmin/deleteInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 6: payInvoice — JWT + RFC 8693 OBO ───────────────────────────────
    server.registerTool(
      'payInvoice',
      {
        title: 'Pay Invoice',
        description:
          "Mark an invoice as paid. Uses RFC 8693 On-Behalf-Of token exchange to obtain a " +
          "payments.widget.com token (payInvoices scope).",
        inputSchema: payInvoiceSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/invoiceAdmin/payInvoice] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'payInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executePayInvoice(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to pay invoice.'
          console.error('[mcp/invoiceAdmin/payInvoice] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 7: rollbackDeleteInvoice — JWT only (test reset) ─────────────────
    server.registerTool(
      'rollbackDeleteInvoice',
      {
        title: 'Rollback Delete Invoice',
        description:
          'Restore all previously deleted invoices in this server instance. ' +
          'Use this to reset test state after running deleteInvoice.',
        inputSchema: rollbackDeleteInvoiceSchema,
      },
      async (_params, ctx) => {
        const mcpCtx = extractCtx(ctx, 'rollbackDeleteInvoice')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        const result = executeRollbackDeleteInvoice()
        console.log('[mcp/invoiceAdmin/rollbackDeleteInvoice] result:', result.text)
        return { content: [{ type: 'text' as const, text: result.text }] }
      },
    )
  },
  {
    serverInfo: { name: 'invoice-admin-mcp-server', version: '1.0.0' },
  },
)

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: false,
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
