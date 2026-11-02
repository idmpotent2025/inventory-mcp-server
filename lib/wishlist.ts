/**
 * In-memory per-user wishlist store.
 * Replace with a database in production.
 */

export interface WishlistEntry {
  vin: string
  addedAt: string // ISO timestamp
  note?: string
}

// keyed by user sub
const store = new Map<string, Map<string, WishlistEntry>>()

function getUserStore(sub: string): Map<string, WishlistEntry> {
  if (!store.has(sub)) store.set(sub, new Map())
  return store.get(sub)!
}

export function getWishlist(sub: string): WishlistEntry[] {
  return Array.from(getUserStore(sub).values())
}

export function addToWishlist(sub: string, vin: string, note?: string): WishlistEntry {
  const entry: WishlistEntry = { vin, addedAt: new Date().toISOString(), note }
  getUserStore(sub).set(vin, entry)
  return entry
}

export function removeFromWishlist(sub: string, vin: string): WishlistEntry | null {
  const userStore = getUserStore(sub)
  const entry = userStore.get(vin) ?? null
  if (entry) userStore.delete(vin)
  return entry
}

export function isOnWishlist(sub: string, vin: string): boolean {
  return getUserStore(sub).has(vin)
}
