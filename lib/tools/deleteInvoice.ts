import { z } from 'zod'
import { deleteInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const deleteInvoiceSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to delete (e.g. inv-001)'),
})

export type DeleteInvoiceInput = z.infer<typeof deleteInvoiceSchema>

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

  console.log('[deleteInvoice] initiating CIBA — sub:', ctx.sub, '| message:', bindingMessage)

  const res = await fetch(`https://${domain}/bc-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[deleteInvoice] CIBA initiation failed — status:', res.status, '| body:', err)
    throw new Error(`CIBA initiation failed: ${err}`)
  }

  const data = (await res.json()) as { auth_req_id: string; expires_in?: number; interval?: number }
  console.log('[deleteInvoice] CIBA initiated — auth_req_id:', data.auth_req_id, '| interval:', data.interval ?? 5)
  return { authReqId: data.auth_req_id, interval: data.interval ?? 5 }
}

// ── CIBA: poll until approved / rejected / expired ────────────────────────────
// Polls inline so the caller gets a result in a single MCP call — no client
// retry or server-side state store required.

async function pollForApproval(authReqId: string, intervalSeconds: number): Promise<void> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!

  const deadline = Date.now() + 50_000 // stay within Vercel's 55s maxDuration
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
      console.log('[deleteInvoice] CIBA approved')
      return
    }

    const { error } = data
    if (error === 'authorization_pending') {
      console.log('[deleteInvoice] CIBA pending — next poll in', pollMs / 1000, 's')
      continue
    } else if (error === 'slow_down') {
      pollMs += 5_000
      console.log('[deleteInvoice] CIBA slow_down — new interval:', pollMs / 1000, 's')
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
 * Executes the deleteInvoice MCP tool.
 *
 * Authorization:
 *   1. CIBA — sends push notification to the user's device and polls
 *             Auth0 inline until approved or rejected. No client retry needed.
 *   2. Core — deletes the invoice once approved.
 */
export async function executeDeleteInvoice(params: DeleteInvoiceInput, ctx: MCPToolContext) {
  console.log('[deleteInvoice] called with:', {
    invoiceId: params.invoiceId,
    sub: ctx.sub,
    tokenPresent: !!ctx.token,
  })

  // Sends push notification and blocks until approved, rejected, or timed out
  const { authReqId, interval } = await initiateCIBA(
    ctx,
    `Approve deletion of invoice ${params.invoiceId}`,
  )
  await pollForApproval(authReqId, interval)

  const deleted = deleteInvoice(params.invoiceId)
  if (!deleted) throw new Error(`Invoice "${params.invoiceId}" not found.`)

  return { success: true, deleted }
}
