import { z } from 'zod'
import { getCarByVin } from '@/lib/cars'
import { getPreApprovalOffers } from '@/lib/loanApplications'
import type { MCPToolContext } from './types'

export const checkPreApprovalSchema = z.object({
  vin: z.string().describe('VIN of the vehicle you want financing for'),
})

export type CheckPreApprovalInput = z.infer<typeof checkPreApprovalSchema>

/**
 * Exchanges the user's auto marketplace token for a lender API token using
 * RFC 8693 On-Behalf-Of token exchange, then fetches pre-approval offers.
 *
 * Incoming token:  audience automarket.autonav.com, scope read:listings
 * Exchanged token: audience lender.autonav.com, scope read:preapprovals
 */
async function exchangeTokenForLender(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_LENDER_EXCHANGE_CLIENT_ID!
  const clientSecret = process.env.AUTH0_LENDER_EXCHANGE_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    audience: 'lender.autonav.com',
    scope: 'read:preapprovals',
  })

  console.log('[checkPreApproval] token exchange → lender.autonav.com | domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[checkPreApproval] token exchange failed — status:', res.status, '| body:', err)
    throw new Error(`Token exchange failed (lender.autonav.com): ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  console.log('[checkPreApproval] token exchange succeeded')
  return data.access_token
}

export async function executeCheckPreApproval(params: CheckPreApprovalInput, ctx: MCPToolContext) {
  const car = getCarByVin(params.vin)
  if (!car) throw new Error(`No listing found for VIN "${params.vin}".`)

  // Exchange marketplace token for lender-scoped token
  await exchangeTokenForLender(ctx.token)

  // Fetch pre-approval offers (simulated; in production: call lender API with lenderToken)
  const offers = getPreApprovalOffers(ctx.sub, car.price)

  return {
    vin: params.vin,
    vehicle: `${car.year} ${car.make} ${car.model} ${car.trim}`,
    listingPrice: car.price,
    offers,
    note: 'Offers are pre-approval estimates. Final rate subject to credit verification.',
  }
}
