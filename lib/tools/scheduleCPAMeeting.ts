import { z } from 'zod'
import type { MCPToolContext } from './types'

export const scheduleCPAMeetingSchema = z.object({
  title: z.string().describe('Meeting title or subject (e.g. "Q3 Tax Review with CPA")'),
  startDateTime: z
    .string()
    .describe('Start date and time in ISO 8601 format with timezone offset, e.g. 2026-11-04T14:00:00-08:00'),
  durationMinutes: z
    .number()
    .default(60)
    .describe('Meeting duration in minutes (default: 60)'),
  description: z
    .string()
    .optional()
    .describe('Optional meeting agenda or notes'),
  attendeeEmail: z
    .string()
    .optional()
    .describe('Optional email address of another attendee to invite'),
})

export type ScheduleCPAMeetingInput = z.infer<typeof scheduleCPAMeetingSchema>

// ── Auth0 Token Vault exchange ────────────────────────────────────────────────
//
// Exchanges the user's MCP access token for their vaulted Google OAuth token
// via Auth0's proprietary Token Vault grant type.
//
async function exchangeForGoogleToken(subjectToken: string): Promise<string> {
  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.AUTH0_CLIENT_ID!
  const clientSecret = process.env.AUTH0_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type: 'urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token',
    client_id: clientId,
    client_secret: clientSecret,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    requested_token_type: 'http://auth0.com/oauth/token-type/federated-connection-access-token',
    connection: 'google-oauth2',
  })

  console.log('[scheduleCPAMeeting] Token Vault exchange — AUTH0_CLIENT_ID set:', !!clientId, '| domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[scheduleCPAMeeting] Token Vault exchange failed — status:', res.status, '| body:', err)
    if (res.status === 403 || err.includes('access_denied') || err.includes('No access token found')) {
      throw new Error('GCAL_NOT_CONNECTED')
    }
    throw new Error(`Token Vault exchange failed: ${err}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Token Vault exchange returned no access_token')
  console.log('[scheduleCPAMeeting] Token Vault exchange succeeded')
  return data.access_token
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeScheduleCPAMeeting(
  params: ScheduleCPAMeetingInput,
  ctx: MCPToolContext,
) {
  const googleToken = await exchangeForGoogleToken(ctx.token)

  // Compute end time from duration
  const start = new Date(params.startDateTime)
  const end = new Date(start.getTime() + params.durationMinutes * 60 * 1000)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const eventBody: Record<string, unknown> = {
    summary: params.title,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  }
  if (params.description) eventBody.description = params.description
  if (params.attendeeEmail) eventBody.attendees = [{ email: params.attendeeEmail }]

  console.log('[scheduleCPAMeeting] creating calendar event:', JSON.stringify(eventBody))

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[scheduleCPAMeeting] Google Calendar API error:', res.status, err)
    throw new Error(`Google Calendar API error (${res.status}): ${err}`)
  }

  const event = (await res.json()) as {
    id?: string
    htmlLink?: string
    summary?: string
    start?: { dateTime?: string }
    end?: { dateTime?: string }
  }

  console.log('[scheduleCPAMeeting] event created — id:', event.id)
  return {
    success: true,
    eventId: event.id,
    title: event.summary,
    start: event.start?.dateTime,
    end: event.end?.dateTime,
    calendarLink: event.htmlLink,
  }
}
