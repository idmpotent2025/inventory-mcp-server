/**
 * In-memory inventory store.
 * In production, replace with a database (e.g. Vercel Postgres / KV).
 */

export interface InventoryItem {
  id: string
  name: string
  quantity: number
  price: number
  comments: string[]
  owner: string       // user sub — used for FGA owner checks
  createdAt: string
}

// Module-level store (shared across requests in the same serverless instance)
const store = new Map<string, InventoryItem>([
  [
    'item-001',
    {
      id: 'item-001',
      name: 'Widget A',
      quantity: 100,
      price: 9.99,
      comments: [],
      owner: 'seed',
      createdAt: new Date().toISOString(),
    },
  ],
  [
    'item-002',
    {
      id: 'item-002',
      name: 'Gadget B',
      quantity: 50,
      price: 24.99,
      comments: [],
      owner: 'seed',
      createdAt: new Date().toISOString(),
    },
  ],
])

export function listItems(): InventoryItem[] {
  return Array.from(store.values())
}

export function getItem(id: string): InventoryItem | undefined {
  return store.get(id)
}

export function addItem(
  name: string,
  quantity: number,
  price: number,
  owner: string,
): InventoryItem {
  const id = `item-${Date.now()}`
  const item: InventoryItem = {
    id,
    name,
    quantity,
    price,
    comments: [],
    owner,
    createdAt: new Date().toISOString(),
  }
  store.set(id, item)
  return item
}

export function deleteItem(id: string): boolean {
  return store.delete(id)
}

export function commentItem(id: string, comment: string): InventoryItem | null {
  const item = store.get(id)
  if (!item) return null
  item.comments.push(comment)
  return item
}
