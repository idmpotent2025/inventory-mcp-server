import { z } from 'zod'
import { getCarByVin } from '@/lib/cars'
import type { MCPToolContext } from './types'

export const scheduleTestDriveSchema = z.object({
  vin: z.string().describe('VIN of the vehicle to test drive'),
  date: z.string().describe('Preferred date in YYYY-MM-DD format'),
  time: z.string().describe('Preferred time in HH:MM (24-hour) format, e.g. 14:30'),
})

export type ScheduleTestDriveInput = z.infer<typeof scheduleTestDriveSchema>

// ── Auth0 Token Vault exchange (Google Calendar) ──────────────────────────────
// Same grant as notifyInvoice but uses the Calendar API instead of Gmail.
async function exchangeForGoogleToken(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_TOKEN_VAULT_CLIENT_ID!
  const clientSecret = process.env.AUTH0_TOKEN_VAULT_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
    connection: 'google-oauth2',
  })

  console.log('[scheduleTestDrive] Token Vault exchange — client:', clientId)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[scheduleTestDrive] Token Vault exchange failed — status:', res.status, '| body:', err)
    if (res.status === 403 || err.includes('access_denied') || err.includes('No access token found')) {
      throw new Error('GOOGLE_NOT_CONNECTED')
    }
    throw new Error(`Token Vault exchange failed: ${err}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Token Vault exchange returned no access_token')
  console.log('[scheduleTestDrive] Token Vault exchange succeeded')
  return data.access_token
}

// ── Google Calendar event creation ───────────────────────────────────────────

async function createCalendarEvent(
  googleToken: string,
  car: { year: number; make: string; model: string; dealerName: string; dealerCity: string; dealerState: string },
  date: string,
  time: string,
): Promise<{ eventId: string; htmlLink: string }> {
  const startDateTime = `${date}T${time}:00`
  const [h, m] = time.split(':').map(Number)
  const endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const endDateTime = `${date}T${endTime}:00`

  const event = {
    summary: `Test Drive: ${car.year} ${car.make} ${car.model}`,
    description: `Test drive appointment at ${car.dealerName}. VIN lookup in your saved listings.`,
    location: `${car.dealerName}, ${car.dealerCity}, ${car.dealerState}`,
    start: { dateTime: startDateTime, timeZone: 'America/Chicago' },
    end: { dateTime: endDateTime, timeZone: 'America/Chicago' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 1440 },
      ],
    },
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google Calendar event creation failed: ${err}`)
  }

  const data = (await res.json()) as { id: string; htmlLink: string }
  return { eventId: data.id, htmlLink: data.htmlLink }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Authorization:
 *   Token Vault — exchanges user's marketplace token for their vaulted Google
 *                 OAuth token via Auth0 Token Vault, then creates a Google
 *                 Calendar event for the test drive appointment.
 */
export async function executeScheduleTestDrive(
  params: ScheduleTestDriveInput,
  ctx: MCPToolContext,
) {
  const car = getCarByVin(params.vin)
  if (!car) throw new Error(`No listing found for VIN "${params.vin}".`)

  const googleToken = await exchangeForGoogleToken(ctx.token)

  const { eventId, htmlLink } = await createCalendarEvent(
    googleToken,
    car,
    params.date,
    params.time,
  )

  return {
    success: true,
    message: `Test drive booked for ${car.year} ${car.make} ${car.model} on ${params.date} at ${params.time} at ${car.dealerName}, ${car.dealerCity} ${car.dealerState}.`,
    calendarEventId: eventId,
    calendarLink: htmlLink,
    dealer: {
      name: car.dealerName,
      city: car.dealerCity,
      state: car.dealerState,
    },
  }
}
