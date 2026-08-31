import { z } from 'zod'
import { rollbackDelete } from '@/lib/invoices'

export const rollbackDeleteSchema = z.object({})

export function executeRollbackDelete(): { text: string } {
  const restored = rollbackDelete()
  if (restored.length === 0) {
    return { text: 'No deleted invoices to restore.' }
  }
  const ids = restored.map((inv) => inv.id).join(', ')
  return { text: `Restored ${restored.length} invoice(s): ${ids}. Invoice list is back to its previous state.` }
}
