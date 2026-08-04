import { z } from 'zod'
import { listInvoices, type InvoiceStatus } from '@/lib/invoices'

export const listInvoicesSchema = z.object({
  status: z
    .enum(['draft', 'pending', 'paid', 'overdue'])
    .optional()
    .describe('Filter invoices by status. Omit to return all invoices.'),
})

export type ListInvoicesInput = z.infer<typeof listInvoicesSchema>

export async function executeListInvoices(params: ListInvoicesInput) {
  const invoices = listInvoices(params.status as InvoiceStatus | undefined)
  return { invoices, count: invoices.length }
}
