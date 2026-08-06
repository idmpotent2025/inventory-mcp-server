import { z } from 'zod'
import {
  TokenVaultAuthorizerBase,
  getCredentialsFromTokenVault,
  SUBJECT_TOKEN_TYPES,
} from '@auth0/ai/TokenVault'
import { MemoryStore } from '@auth0/ai/stores'
import { getInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const notifyViaGmailSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to send notification for (e.g. inv-001)'),
  message: z.string().optional().describe('Optional custom message or note to include'),
})

export type NotifyViaGmailInput = z.infer<typeof notifyViaGmailSchema>
type ToolArgs = [NotifyViaGmailInput, MCPToolContext]

// ── Module-level store (safe at module load — no env vars needed) ──────────────
const store = new MemoryStore()

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

// ── Context extractor ─────────────────────────────────────────────────────────
const getContext = (_params: NotifyViaGmailInput, ctx: MCPToolContext) => ({
  threadID: ctx.sub,
  toolCallID: ctx.toolCallId,
  toolName: 'notifyViaGmail',
})

// ── Core execution ────────────────────────────────────────────────────────────
//
// Runs after TokenVault populates AsyncLocalStorage with the Google token.
//
const coreExecute = async (params: NotifyViaGmailInput, ctx: MCPToolContext) => {
  const invoice = getInvoice(params.invoiceId)
  if (!invoice) throw new Error(`Invoice "${params.invoiceId}" not found.`)

  const googleToken = getCredentialsFromTokenVault()?.accessToken
  if (!googleToken) throw new Error('Google token not available from Token Vault.')

  // Recipient: email claim from the user's access token, fallback to polo4@atko.email
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

// ── Lazy authorizer chain ─────────────────────────────────────────────────────
//
// TokenVaultAuthorizerBase validates env vars in its constructor — must NOT be
// instantiated at module load time (Vercel build has no env vars yet).
// getChain() creates it once on the first real request and caches the result.
//
type Chain = (params: NotifyViaGmailInput, ctx: MCPToolContext) => Promise<unknown>
let _chain: Chain | null = null

function getChain(): Chain {
  if (_chain) return _chain

  const auth0 = {
    domain: process.env.AUTH0_DOMAIN ?? '',
    clientId: process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_ID ?? '',
    clientSecret: process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET,
  }

  // RFC 8693 OBO: exchange user's MCP token for a Google token stored in
  // Auth0 Token Vault for the `google-oauth2` connection.
  const tokenVaultAuthorizer = new TokenVaultAuthorizerBase<ToolArgs>(auth0, {
    store,
    connection: 'google-oauth2',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    accessToken: (_params, ctx) => ctx.token,
    subjectTokenType: SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_ACCESS_TOKEN,
  })

  _chain = tokenVaultAuthorizer.protect(getContext, coreExecute) as Chain
  return _chain
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes the notifyViaGmail MCP tool with Auth0 Token Vault protection.
 *
 * Authorization flow:
 *   1. Token Vault (OBO) — exchanges the user's MCP access token for a
 *      federated Google token via Auth0 Token Vault (google-oauth2 connection)
 *   2. Core — sends Gmail email to the address from the user's access token
 */
export async function executeNotifyViaGmail(params: NotifyViaGmailInput, ctx: MCPToolContext) {
  return getChain()(params, ctx)
}
