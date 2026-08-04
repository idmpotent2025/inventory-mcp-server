import { z } from 'zod'
import { AsyncAuthorizerBase } from '@auth0/ai/AsyncAuthorization'
import { MemoryStore } from '@auth0/ai/stores'
import { deleteInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const deleteInvoiceSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to delete (e.g. inv-001)'),
})

export type DeleteInvoiceInput = z.infer<typeof deleteInvoiceSchema>
type ToolArgs = [DeleteInvoiceInput, MCPToolContext]

// ── Module-level store (safe at module load — no env vars needed) ──────────────
const store = new MemoryStore()

// ── Context extractor ─────────────────────────────────────────────────────────
const getContext = (_params: DeleteInvoiceInput, ctx: MCPToolContext) => ({
  threadID: ctx.sub,
  toolCallID: ctx.toolCallId,
  toolName: 'deleteInvoice',
})

// ── Core execution ────────────────────────────────────────────────────────────
const coreExecute = async (params: DeleteInvoiceInput, _ctx: MCPToolContext) => {
  const deleted = deleteInvoice(params.invoiceId)
  if (!deleted) {
    throw new Error(`Invoice "${params.invoiceId}" not found.`)
  }
  return { success: true, deleted }
}

// ── Lazy authorizer chain ─────────────────────────────────────────────────────
type Chain = (params: DeleteInvoiceInput, ctx: MCPToolContext) => Promise<unknown>
let _chain: Chain | null = null

function getChain(): Chain {
  if (_chain) return _chain

  const auth0 = {
    domain: process.env.AUTH0_DOMAIN ?? '',
    clientId: process.env.AUTH0_CLIENT_ID ?? '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
  }

  console.log('[deleteInvoice] CIBA auth0 config:', {
    domain: auth0.domain || '⚠️ MISSING',
    clientId: auth0.clientId ? `${auth0.clientId.slice(0, 6)}…` : '⚠️ MISSING',
    clientSecret: auth0.clientSecret ? '✓ set' : '⚠️ MISSING',
    audience: process.env.AUTH0_AUDIENCE || '⚠️ MISSING',
  })

  // CIBA step-up: sends a push notification to the user's device requiring
  // explicit approval before the invoice is permanently deleted.
  // Throws AsyncAuthorizationInterrupt on first call; the MCP client retries
  // after the user approves on their device.
  const cibaAuthorizer = new AsyncAuthorizerBase<ToolArgs>(auth0, {
    store,
    scopes: ['openid'],
    userID: (_params, ctx) => ctx.sub,
    bindingMessage: (params) => `Approve deletion of invoice ${params.invoiceId}`,
    audience: process.env.AUTH0_AUDIENCE,
    credentialsContext: 'thread',
  })

  _chain = cibaAuthorizer.protect(getContext, coreExecute) as Chain
  return _chain
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes the deleteInvoice MCP tool.
 *
 * Authorization:
 *   1. CIBA — sends push notification; throws AsyncAuthorizationInterrupt
 *             until the user approves on their device
 *   2. Core — deletes the invoice from the store
 */
export async function executeDeleteInvoice(params: DeleteInvoiceInput, ctx: MCPToolContext) {
  console.log('[deleteInvoice] called with:', {
    invoiceId: params.invoiceId,
    sub: ctx.sub,
    tokenPresent: !!ctx.token,
  })
  return getChain()(params, ctx)
}
