import { z } from 'zod'
import { getInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const notifyViaGmailSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to send notification for (e.g. inv-001)'),
  message: z.string().optional().describe('Optional custom message or note to include'),
})

export type NotifyViaGmailInput = z.infer<typeof notifyViaGmailSchema>

// ── Decode email from JWT payload (already verified by route handler) ──────────
function decodeTokenEmail(token: string): string | undefined {
  try {
    const payload = token.split('.')[1]
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return decoded.email as string | undefined
  } catch {
    return undefined
  }
}

// ── Auth0 Token Vault exchange ────────────────────────────────────────────────
//
// Exchanges the user's MCP access token for their vaulted Google OAuth token
// via Auth0's proprietary Token Vault grant type.
// Uses AUTH0_TOKEN_VAULT_CLIENT_ID / AUTH0_TOKEN_VAULT_CLIENT_SECRET — the
// dedicated Custom API Client (mysamplemcpclientAug2026) with Token Vault grant
// and google-oauth2 connection enabled.
//
async function exchangeForGoogleToken(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_TOKEN_VAULT_CLIENT_ID!
  const clientSecret = process.env.AUTH0_TOKEN_VAULT_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
    connection: 'google-oauth2',
  })

  console.log('[notifyViaGmail] Token Vault exchange — client:', clientId, '| domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[notifyViaGmail] Token Vault exchange failed — status:', res.status, '| body:', err)

    // No vaulted token found — user needs to connect Gmail in the Portal
    if (res.status === 403 || err.includes('access_denied') || err.includes('No access token found')) {
      throw new Error('GMAIL_NOT_CONNECTED')
    }
    throw new Error(`Token Vault exchange failed: ${err}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Token Vault exchange returned no access_token')
  }
  console.log('[notifyViaGmail] Token Vault exchange succeeded')
  return data.access_token
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeNotifyViaGmail(params: NotifyViaGmailInput, ctx: MCPToolContext) {
  const invoice = getInvoice(params.invoiceId)
  if (!invoice) throw new Error(`Invoice "${params.invoiceId}" not found.`)

  const googleToken = await exchangeForGoogleToken(ctx.token)

  const recipient = decodeTokenEmail(ctx.token) ?? 'polo4@atko.email'
  console.log('[notifyViaGmail] sending to:', recipient)

  const subject = `Invoice Notification: ${invoice.id}`
  const lines = [
    `Invoice: ${invoice.id}`,
    `Amount:  $${invoice.amount.toFixed(2)}`,
    `Due:     ${invoice.dueDate}`,
    `Status:  ${invoice.status}`,
    `Description: ${invoice.description}`,
  ]
  if (params.message) lines.push(`\nNote: ${params.message}`)

  const mime = [
    `To: ${recipient}`,
    'Content-Type: text/plain; charset=utf-8',
    `Subject: ${subject}`,
    '',
    lines.join('\n'),
  ].join('\r\n')
  const raw = Buffer.from(mime).toString('base64url')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail send failed: ${err}`)
  }
  return {
    success: true,
    invoiceId: params.invoiceId,
    recipient,
    subject,
  }
}
