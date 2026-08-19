import { z } from 'zod'
import { getInvoice, updateInvoiceStatus } from '@/lib/invoices'
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
  console.log(`[payInvoice] ${label} claims:`, JSON.stringify({
    iss: c.iss,
    aud: c.aud,
    sub: c.sub,
    scope: c.scope,
    exp: c.exp,
    azp: c.azp,
  }))
}

export const payInvoiceSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to pay (e.g. inv-001)'),
})

export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>

/**
 * Exchanges the user's invoices.widget.com access token for a
 * payments.widget.com token using RFC 8693 On-Behalf-Of token exchange.
 *
 * The incoming token has:
 *   audience: invoices.widget.com  permissions: listInvoices, addInvoices
 *
 * The exchanged token has:
 *   audience: payments.widget.com  permissions: payInvoices
 */
async function exchangeTokenForPayments(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_ID!
  const clientSecret = process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'cloud.oktademo.redsalsa.mcpserverclient:access_token',
    audience: 'payments.widget.com',
    scope: 'payInvoices',
  })

  console.log('[payInvoice] token exchange request — audience: payments.widget.com | scope: payInvoices | domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[payInvoice] token exchange failed — status:', res.status, '| body:', err)
    throw new Error(`Token exchange failed (payments.widget.com): ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  console.log('[payInvoice] token exchange succeeded — status:', res.status)
  return data.access_token
}

/**
 * Executes the payInvoice MCP tool.
 *
 * Authorization:
 *   1. RFC 8693 OBO token exchange — user's invoices.widget.com token →
 *      payments.widget.com token with payInvoices scope
 *   2. Core — marks the invoice as paid (in production: calls the payments service)
 */
export async function executePayInvoice(params: PayInvoiceInput, ctx: MCPToolContext) {
  const invoice = getInvoice(params.invoiceId)
  if (!invoice) {
    throw new Error(`Invoice "${params.invoiceId}" not found.`)
  }
  if (invoice.status === 'paid') {
    return {
      success: true,
      message: `Invoice ${invoice.id} is already marked as paid.`,
      invoice,
    }
  }

  // Log incoming token claims before the exchange
  logTokenClaims('incoming', ctx.token)

  // Exchange the user's token for a payments-scoped token
  const paymentsToken = await exchangeTokenForPayments(ctx.token)

  // Log the exchanged token claims
  logTokenClaims('exchanged (payments)', paymentsToken)

  const updated = updateInvoiceStatus(params.invoiceId, 'paid')
  return {
    success: true,
    message: `Invoice ${invoice.id} ($${invoice.amount.toFixed(2)}) has been paid successfully.`,
    invoice: updated,
  }
}
