import { z } from 'zod'
import { listItems } from '@/lib/inventory'

export const listInventorySchema = z.object({})

export async function executeListInventory() {
  const items = listItems()
  return { items, count: items.length }
}
