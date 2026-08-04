import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { addInvoice } from '@/lib/invoices'
import type { MCPToolContext } from './types'

export const addInvoiceSchema = z.object({
  amount: z.number().min(0).describe('Invoice amount in USD'),
  description: z.string().describe('Description of the services or products invoiced'),
  dueDate: z.string().describe('Payment due date in YYYY-MM-DD format'),
})

export type AddInvoiceInput = z.infer<typeof addInvoiceSchema>

/**
 * Executes the addInvoice MCP tool.
 *
 * Authorization:
 *   1. FGA — verifies `user:<sub> writer invoices:default`
 *   2. Core — creates the invoice in the store
 */
export async function executeAddInvoice(params: AddInvoiceInput, ctx: MCPToolContext) {
  // Step 1: FGA writer check
  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user: `user:${ctx.sub}`,
    relation: 'writer',
    object: 'invoices:invoiceA',
  })
  if (!allowed) {
    throw new Error('Forbidden: you do not have writer access to invoices.')
  }

  // Step 2: Create the invoice
  const invoice = addInvoice(params.amount, params.description, params.dueDate)
  return { success: true, invoice }
}
