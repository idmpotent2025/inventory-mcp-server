import { z } from 'zod'
import { getWishlist } from '@/lib/wishlist'
import { getCarByVin } from '@/lib/cars'
import type { MCPToolContext } from './types'

export const getWishlistSchema = z.object({})

export type GetWishlistInput = z.infer<typeof getWishlistSchema>

export function executeGetWishlist(_params: GetWishlistInput, ctx: MCPToolContext) {
  const entries = getWishlist(ctx.sub)
  const items = entries.map((entry) => ({
    ...entry,
    car: getCarByVin(entry.vin) ?? null,
  }))
  return { wishlist: items, count: items.length }
}
