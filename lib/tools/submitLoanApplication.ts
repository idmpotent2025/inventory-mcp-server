import { z } from 'zod'
import { getCarByVin } from '@/lib/cars'
import { submitLoanApplication } from '@/lib/loanApplications'
import type { MCPToolContext } from './types'

export const submitLoanApplicationSchema = z.object({
  vin: z.string().describe('VIN of the vehicle'),
  requestedAmount: z.number().min(1000).describe('Loan amount requested in USD'),
  termMonths: z.number().int().min(12).max(84).describe('Loan term in months (12–84)'),
  apr: z.number().min(0).max(30).describe('APR from your pre-approval offer'),
})

export type SubmitLoanApplicationInput = z.infer<typeof submitLoanApplicationSchema>

// ── CIBA helpers (shared pattern — same as deleteInvoice) ─────────────────────

async function initiateCIBA(
  ctx: MCPToolContext,
  bindingMessage: string,
): Promise<{ authReqId: string; interval: number }> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!
  const audience = process.env.AUTH0_AUDIENCE!

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    login_hint: JSON.stringify({ format: 'iss_sub', iss: `https://${domain}/`, sub: ctx.sub }),
    scope: 'openid',
    audience,
    binding_message: bindingMessage,
    request_expiry: '120',
  })

  console.log('[submitLoan] initiating CIBA — sub:', ctx.sub, '| message:', bindingMessage)

  const res = await fetch(`https://${domain}/bc-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`CIBA initiation failed: ${err}`)
  }

  const data = (await res.json()) as { auth_req_id: string; interval?: number }
  console.log('[submitLoan] CIBA initiated — auth_req_id:', data.auth_req_id)
  return { authReqId: data.auth_req_id, interval: data.interval ?? 5 }
}

async function pollForApproval(authReqId: string, intervalSeconds: number): Promise<void> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!

  const deadline = Date.now() + 50_000
  let pollMs = intervalSeconds * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))

    const body = new URLSearchParams({
      grant_type: 'urn:openid:params:grant-type:ciba',
      auth_req_id: authReqId,
      client_id: clientId,
      client_secret: clientSecret,
    })

    const res = await fetch(`https://${domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const data = (await res.json()) as { error?: string; access_token?: string }

    if (res.ok) {
      console.log('[submitLoan] CIBA approved')
      return
    }

    const { error } = data
    if (error === 'authorization_pending') continue
    else if (error === 'slow_down') { pollMs += 5_000; continue }
    else if (error === 'access_denied') throw new Error('Authorization denied: loan submission was rejected on your device.')
    else if (error === 'expired_token') throw new Error('Authorization expired: push notification was not approved in time.')
    else throw new Error(`CIBA poll error: ${JSON.stringify(data)}`)
  }

  throw new Error('Authorization timed out: please try again and approve the push notification promptly.')
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Authorization:
 *   CIBA — sends push notification to the user's device and polls inline
 *           until approved or rejected. No client retry needed.
 */
export async function executeSubmitLoanApplication(
  params: SubmitLoanApplicationInput,
  ctx: MCPToolContext,
) {
  const car = getCarByVin(params.vin)
  if (!car) throw new Error(`No listing found for VIN "${params.vin}".`)

  const label = `${car.year} ${car.make} ${car.model}`
  const { authReqId, interval } = await initiateCIBA(
    ctx,
    `Confirm loan application: $${params.requestedAmount.toLocaleString()} for ${label}`,
  )
  await pollForApproval(authReqId, interval)

  const application = submitLoanApplication(
    ctx.sub,
    params.vin,
    params.requestedAmount,
    params.termMonths,
    params.apr,
  )

  return {
    success: true,
    message: `Loan application submitted for ${label}. Application ID: ${application.applicationId}`,
    application,
  }
}
