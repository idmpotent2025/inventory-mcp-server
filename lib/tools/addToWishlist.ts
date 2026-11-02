import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { getCarByVin } from '@/lib/cars'
import { addToWishlist } from '@/lib/wishlist'
import type { MCPToolContext } from './types'

export const addToWishlistSchema = z.object({
  vin: z.string().describe('Vehicle Identification Number of the car to save'),
  note: z.string().optional().describe('Optional personal note about this car'),
})

export type AddToWishlistInput = z.infer<typeof addToWishlistSchema>

/**
 * Authorization:
 *   FGA — verifies `user:<sub> can_update wishlist:default`
 *
 * FGA model:
 *   type wishlist
 *     relations
 *       define can_update: [user]
 *       define can_share: [user]
 */
export async function executeAddToWishlist(params: AddToWishlistInput, ctx: MCPToolContext) {
  const car = getCarByVin(params.vin)
  if (!car) throw new Error(`No listing found for VIN "${params.vin}".`)

  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user: `user:${ctx.sub}`,
    relation: 'can_update',
    object: 'wishlist:default',
  })
  if (!allowed) {
    throw new Error('Forbidden: you do not have permission to update this wishlist.')
  }

  const entry = addToWishlist(ctx.sub, params.vin, params.note)
  return {
    success: true,
    message: `${car.year} ${car.make} ${car.model} saved to your wishlist.`,
    entry,
  }
}
