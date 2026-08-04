import { z } from 'zod'
import {
  TokenVaultAuthorizerBase,
  getCredentialsFromTokenVault,
  SUBJECT_TOKEN_TYPES,
} from '@auth0/ai/TokenVault'
import { MemoryStore } from '@auth0/ai/stores'
import { getInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const notifyInvoiceSchema = z.object({
  invoiceId: z.string().describe('ID of the invoice to send notification for (e.g. inv-001)'),
  type: z
    .enum(['email', 'calendar'])
    .describe('Notification type: "email" sends a Gmail message, "calendar" adds a Google Calendar reminder on the due date'),
  message: z.string().optional().describe('Optional custom message or note to include'),
})

export type NotifyInvoiceInput = z.infer<typeof notifyInvoiceSchema>
type ToolArgs = [NotifyInvoiceInput, MCPToolContext]

// ── Module-level store (safe at module load — no env vars needed) ──────────────
const store = new MemoryStore()

// ── Context extractor ─────────────────────────────────────────────────────────
const getContext = (_params: NotifyInvoiceInput, ctx: MCPToolContext) => ({
  threadID: ctx.sub,
  toolCallID: ctx.toolCallId,
  toolName: 'notifyInvoice',
})

// ── Core execution ────────────────────────────────────────────────────────────
//
// Runs after TokenVault populates AsyncLocalStorage with the Google token.
//
const coreExecute = async (params: NotifyInvoiceInput, _ctx: MCPToolContext) => {
  const invoice = getInvoice(params.invoiceId)
  if (!invoice) throw new Error(`Invoice "${params.invoiceId}" not found.`)

  const googleToken = getCredentialsFromTokenVault()?.accessToken
  if (!googleToken) throw new Error('Google token not available from Token Vault.')

  if (params.type === 'email') {
    const recipient = process.env.NOTIFICATION_EMAIL_TO
    if (!recipient) throw new Error('NOTIFICATION_EMAIL_TO env var is not set.')

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
      type: 'email',
      invoiceId: params.invoiceId,
      recipient,
      subject,
    }
  }

  // ── Google Calendar event ──────────────────────────────────────────────────
  const descriptionLines = [
    invoice.description,
    `Amount: $${invoice.amount.toFixed(2)}`,
    `Status: ${invoice.status}`,
  ]
  if (params.message) descriptionLines.push(`Note: ${params.message}`)

  const event = {
    summary: `Invoice Due: ${invoice.id} — $${invoice.amount.toFixed(2)}`,
    description: descriptionLines.join('\n'),
    start: { date: invoice.dueDate },
    end: { date: invoice.dueDate },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },  // 1 day before
        { method: 'popup', minutes: 60 },          // 1 hour before
      ],
    },
  }

  const calRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  )
  if (!calRes.ok) {
    const err = await calRes.text()
    throw new Error(`Google Calendar event creation failed: ${err}`)
  }
  const calEvent = (await calRes.json()) as { id: string; htmlLink?: string }
  return {
    success: true,
    type: 'calendar',
    invoiceId: params.invoiceId,
    eventId: calEvent.id,
    eventLink: calEvent.htmlLink,
  }
}

// ── Lazy authorizer chain ─────────────────────────────────────────────────────
//
// TokenVaultAuthorizerBase validates env vars in its constructor — must NOT be
// instantiated at module load time (Vercel build has no env vars yet).
// getChain() creates it once on the first real request and caches the result.
//
type Chain = (params: NotifyInvoiceInput, ctx: MCPToolContext) => Promise<unknown>
let _chain: Chain | null = null

function getChain(): Chain {
  if (_chain) return _chain

  const auth0 = {
    domain: process.env.AUTH0_DOMAIN ?? '',
    clientId: process.env.AUTH0_CLIENT_ID ?? '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
  }

  // RFC 8693 OBO: exchange user's MCP token for a Google token stored in
  // Auth0 Token Vault for the `google-oauth2` connection.
  const tokenVaultAuthorizer = new TokenVaultAuthorizerBase<ToolArgs>(auth0, {
    store,
    connection: 'google-oauth2',
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    accessToken: (_params, ctx) => ctx.token,
    subjectTokenType: SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_ACCESS_TOKEN,
  })

  _chain = tokenVaultAuthorizer.protect(getContext, coreExecute) as Chain
  return _chain
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes the notifyInvoice MCP tool with Auth0 Token Vault protection.
 *
 * Authorization flow:
 *   1. Token Vault (OBO) — exchanges the user's MCP access token for a
 *      federated Google token via Auth0 Token Vault (google-oauth2 connection)
 *   2. Core — sends Gmail email OR creates Google Calendar reminder
 */
export async function executeNotifyInvoice(params: NotifyInvoiceInput, ctx: MCPToolContext) {
  return getChain()(params, ctx)
}
