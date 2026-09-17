import { z } from 'zod'
import { getPetByName, addMedication } from '@/lib/pets'
import type { MCPToolContext } from './types'

export const addPetMedicationSchema = z.object({
  petName:        z.string().describe('Name of the pet'),
  medicationName: z.string().describe('Name of the medication to add'),
  dosage:         z.string().describe('Dosage instructions (e.g. "16mg daily")'),
})

export type AddPetMedicationInput = z.infer<typeof addPetMedicationSchema>

// ── RFC 8693 Token Exchange ────────────────────────────────────────────────────
// Exchange the user's portal token for a medication:write-scoped token.

async function exchangeTokenForMedicationWrite(subjectToken: string): Promise<string> {
  const domain      = process.env.AUTH0_DOMAIN!
  const clientId     = process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_ID!
  const clientSecret = process.env.AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET!

  const body = new URLSearchParams({
    grant_type:          'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id:           clientId,
    client_secret:       clientSecret,
    subject_token:       subjectToken,
    subject_token_type:  'cloud.oktademo.redsalsa.mcpserverclient:access_token',
    audience:            'petsmart.widget.com',
    scope:               'medication:write',
  })

  console.log('[addPetMedication] token exchange request — audience: petsmart.widget.com | scope: medication:write')

  const res = await fetch(`https://${domain}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[addPetMedication] token exchange failed — status:', res.status, '| body:', err)
    throw new Error(`Token exchange failed (petsmart.widget.com): ${err}`)
  }

  const data = (await res.json()) as { access_token: string }
  console.log('[addPetMedication] token exchange succeeded')
  return data.access_token
}

/**
 * Executes the addPetMedication MCP tool.
 *
 * Authorization:
 *   1. RFC 8693 Token Exchange — portal token → petsmart.widget.com token
 *      with medication:write scope
 *   2. Core — adds the medication in pending_vet_approval state
 */
export async function executeAddPetMedication(params: AddPetMedicationInput, ctx: MCPToolContext) {
  const pet = getPetByName(params.petName)
  if (!pet) throw new Error(`Pet "${params.petName}" not found.`)

  // Exchange token before writing
  await exchangeTokenForMedicationWrite(ctx.token)

  const medication = addMedication(pet.id, params.medicationName, params.dosage)
  return {
    auth_pattern: 'Token Exchange (RFC 8693) — portal token exchanged for petsmart.widget.com token with medication:write scope',
    success: true,
    message: `Medication "${params.medicationName}" added for ${pet.name}, awaiting vet approval.`,
    medication,
  }
}
