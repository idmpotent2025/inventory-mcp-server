import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { getMedication, decrementRefill } from '@/lib/pets'
import type { MCPToolContext } from './types'

export const refillPetMedicationSchema = z.object({
  medicationId: z.string().describe('ID of the medication to refill (e.g. med-101)'),
})

export type RefillPetMedicationInput = z.infer<typeof refillPetMedicationSchema>

/**
 * Executes the refillPetMedication MCP tool.
 *
 * Authorization:
 *   1. FGA — verifies `user:<sub> owner medication:<medicationId>`
 *   2. Core — decrements the refill count by one
 */
export async function executeRefillPetMedication(
  params: RefillPetMedicationInput,
  ctx: MCPToolContext,
) {
  const med = getMedication(params.medicationId)
  if (!med) throw new Error(`Medication "${params.medicationId}" not found.`)

  // Step 1: FGA owner check
  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user:     `user:${ctx.sub}`,
    relation: 'owner',
    object:   `medication:${params.medicationId}`,
  })
  if (!allowed) {
    throw new Error(`Forbidden: you do not have owner access to medication ${params.medicationId}.`)
  }

  // Step 2: Decrement refill
  if (med.refills <= 0) {
    throw new Error(`No refills remaining for "${med.name}". Please contact your vet.`)
  }
  const updated = decrementRefill(params.medicationId)
  if (!updated) throw new Error('Refill failed — medication not found after FGA check.')

  return {
    auth_pattern: 'Fine-Grained Authorization (FGA) — verified owner:medication relationship before allowing refill',
    success: true,
    message: `Refill processed for "${updated.name}". ${updated.refills} refill(s) remaining.`,
    medication: updated,
  }
}
