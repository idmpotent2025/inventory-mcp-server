import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { getCarByVin } from '@/lib/cars'
import { removeFromWishlist } from '@/lib/wishlist'
import type { MCPToolContext } from './types'

export const removeFromWishlistSchema = z.object({
  vin: z.string().describe('Vehicle Identification Number of the car to remove from wishlist'),
})

export type RemoveFromWishlistInput = z.infer<typeof removeFromWishlistSchema>

/**
 * Authorization:
 *   FGA — verifies `user:<sub> can_update wishlist:default`
 */
export async function executeRemoveFromWishlist(params: RemoveFromWishlistInput, ctx: MCPToolContext) {
  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user: `user:${ctx.sub}`,
    relation: 'can_update',
    object: 'wishlist:default',
  })
  if (!allowed) {
    throw new Error('Forbidden: you do not have permission to update this wishlist.')
  }

  const removed = removeFromWishlist(ctx.sub, params.vin)
  if (!removed) throw new Error(`VIN "${params.vin}" was not found in your wishlist.`)

  const car = getCarByVin(params.vin)
  const label = car ? `${car.year} ${car.make} ${car.model}` : params.vin
  return {
    success: true,
    message: `${label} removed from your wishlist.`,
    vin: params.vin,
  }
}
