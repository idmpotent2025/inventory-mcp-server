/**
 * Auth0 Management API helpers.
 *
 * Obtains an M2M token via client credentials (cached until 60s before expiry)
 * and exposes one function per operation used by the delegatedAdmin tools.
 *
 * Required env vars: AUTH0_DOMAIN, DELADMIN_A0_MGMT_CLIENT_ID, DELADMIN_A0_MGMT_CLIENT_SECRET
 * The M2M client must be authorized for the Management API with:
 *   create:organization_invitations
 *   create:user_tickets
 *   delete:organization_members
 *   create:organization_members
 */

let cachedToken: { token: string; expiresAt: number } | null = null

async function getManagementApiToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token
  }

  const domain = process.env.AUTH0_DOMAIN!
  const clientId = process.env.DELADMIN_A0_MGMT_CLIENT_ID!
  const clientSecret = process.env.DELADMIN_A0_MGMT_CLIENT_SECRET!

  console.log('[auth0Management] fetching M2M token — domain:', domain)

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[auth0Management] M2M token request failed — status:', res.status, '| body:', err)
    throw new Error(`Management API token request failed: ${err}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  console.log('[auth0Management] M2M token obtained — expires_in:', data.expires_in)
  return cachedToken.token
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OrgInvitation {
  id: string
  invitationUrl: string
  inviteeEmail: string
  expiresAt: string
}

/**
 * Sends an organization invitation email via Auth0.
 * POST /api/v2/organizations/{orgId}/invitations
 *
 * Required Management API scope: create:organization_invitations
 */
export async function inviteOrgMember(
  orgId: string,
  email: string,
  inviterName: string,
): Promise<OrgInvitation> {
  const domain = process.env.AUTH0_DOMAIN!
  const portalClientId = process.env.AUTH0_CLIENT_ID!
  const token = await getManagementApiToken()

  console.log('[auth0Management] inviteOrgMember — orgId:', orgId, '| email:', email)

  const res = await fetch(`https://${domain}/api/v2/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      invitee: { email },
      inviter: { name: inviterName },
      client_id: portalClientId,
      send_invitation_email: true,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[auth0Management] inviteOrgMember failed — status:', res.status, '| body:', err)
    throw new Error(`Failed to send org invitation: ${err}`)
  }

  const data = (await res.json()) as {
    id: string
    invitation_url: string
    invitee: { email: string }
    expires_at: string
  }

  console.log('[auth0Management] invitation sent — id:', data.id)
  return {
    id: data.id,
    invitationUrl: data.invitation_url,
    inviteeEmail: data.invitee.email,
    expiresAt: data.expires_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PasswordChangeTicket {
  ticket: string
}

/**
 * Generates a password change ticket (URL) for the given Auth0 user.
 * POST /api/v2/tickets/password-change
 *
 * Required Management API scope: create:user_tickets
 */
export async function resetUserPassword(userId: string): Promise<PasswordChangeTicket> {
  const domain = process.env.AUTH0_DOMAIN!
  const token = await getManagementApiToken()

  console.log('[auth0Management] resetUserPassword — userId:', userId)

  const res = await fetch(`https://${domain}/api/v2/tickets/password-change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id: userId,
      mark_email_as_verified: false,
      ttl_sec: 604800,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[auth0Management] resetUserPassword failed — status:', res.status, '| body:', err)
    throw new Error(`Failed to generate password reset ticket: ${err}`)
  }

  const data = (await res.json()) as { ticket: string }
  console.log('[auth0Management] password reset ticket created')
  return { ticket: data.ticket }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes a user from an Auth0 organization.
 * DELETE /api/v2/organizations/{orgId}/members
 *
 * Required Management API scope: delete:organization_members
 */
export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  const domain = process.env.AUTH0_DOMAIN!
  const token = await getManagementApiToken()

  console.log('[auth0Management] removeOrgMember — orgId:', orgId, '| userId:', userId)

  const res = await fetch(`https://${domain}/api/v2/organizations/${orgId}/members`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ members: [userId] }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[auth0Management] removeOrgMember failed — status:', res.status, '| body:', err)
    throw new Error(`Failed to remove org member: ${err}`)
  }

  console.log('[auth0Management] member removed from org')
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a user to an Auth0 organization.
 * POST /api/v2/organizations/{orgId}/members
 *
 * Required Management API scope: create:organization_members
 */
export async function addOrgMember(orgId: string, userId: string): Promise<void> {
  const domain = process.env.AUTH0_DOMAIN!
  const token = await getManagementApiToken()

  console.log('[auth0Management] addOrgMember — orgId:', orgId, '| userId:', userId)

  const res = await fetch(`https://${domain}/api/v2/organizations/${orgId}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ members: [userId] }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[auth0Management] addOrgMember failed — status:', res.status, '| body:', err)
    throw new Error(`Failed to add org member: ${err}`)
  }

  console.log('[auth0Management] member added to org')
}
