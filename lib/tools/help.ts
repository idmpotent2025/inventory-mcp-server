import { z } from 'zod'

export const helpSchema = z.object({})

export type HelpInput = z.infer<typeof helpSchema>

const HELP_TEXT = `
Invoice MCP Server — available tools:

• listInvoices       List invoices, optionally filtered by status (draft / pending / paid / overdue).
• addInvoice         Create a new draft invoice with amount, description, and due date. Requires FGA writer permission.
• notifyViaGmail     Send an invoice notification email via the user's Gmail account (Auth0 Token Vault OBO).
• payInvoice         Mark an invoice as paid (RFC 8693 token exchange for payments scope).
• deleteInvoice      Permanently delete an invoice after CIBA push approval on the user's device.
• help               Show this message.

Tip: most mutations require Auth0 authorization (FGA, Token Vault, or CIBA). If you see an "Authorization pending" response, follow the prompt to approve and then retry the same command.
`.trim()

export function executeHelp(_params: HelpInput): { text: string } {
  return { text: HELP_TEXT }
}
