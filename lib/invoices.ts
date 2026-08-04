/**
 * In-memory invoice store.
 * In production, replace with a database (e.g. Vercel Postgres / KV).
 */

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue'

export interface Invoice {
  id: string
  amount: number
  description: string
  dueDate: string       // YYYY-MM-DD
  status: InvoiceStatus
}

const store = new Map<string, Invoice>([
  ['inv-001', {
    id: 'inv-001',
    amount: 2500.00,
    description: 'Software development services — July 2026',
    dueDate: '2026-08-15',
    status: 'pending',
  }],
  ['inv-002', {
    id: 'inv-002',
    amount: 800.00,
    description: 'Cloud infrastructure — June 2026',
    dueDate: '2026-07-30',
    status: 'overdue',
  }],
  ['inv-003', {
    id: 'inv-003',
    amount: 1200.00,
    description: 'Brand refresh and UI/UX design',
    dueDate: '2026-09-01',
    status: 'draft',
  }],
  ['inv-004', {
    id: 'inv-004',
    amount: 3750.00,
    description: 'Data pipeline setup and analytics dashboard',
    dueDate: '2026-07-01',
    status: 'paid',
  }],
  ['inv-005', {
    id: 'inv-005',
    amount: 950.00,
    description: 'Security audit and penetration testing',
    dueDate: '2026-08-20',
    status: 'pending',
  }],
])

export function listInvoices(status?: InvoiceStatus): Invoice[] {
  const all = Array.from(store.values())
  return status ? all.filter((inv) => inv.status === status) : all
}

export function getInvoice(id: string): Invoice | undefined {
  return store.get(id)
}

export function addInvoice(
  amount: number,
  description: string,
  dueDate: string,
): Invoice {
  const id = `inv-${Date.now()}`
  const invoice: Invoice = { id, amount, description, dueDate, status: 'draft' }
  store.set(id, invoice)
  return invoice
}

export function updateInvoiceStatus(id: string, status: InvoiceStatus): Invoice | null {
  const invoice = store.get(id)
  if (!invoice) return null
  invoice.status = status
  return invoice
}
