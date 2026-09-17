import { z } from 'zod'
import { getPetByName, getMedicationsForPet } from '@/lib/pets'

export const listPetMedicationsSchema = z.object({
  petName: z.string().describe('Name of the pet (e.g. Max, Bella, Charlie)'),
})

export type ListPetMedicationsInput = z.infer<typeof listPetMedicationsSchema>

export async function executeListPetMedications(params: ListPetMedicationsInput) {
  const pet = getPetByName(params.petName)
  if (!pet) throw new Error(`Pet "${params.petName}" not found.`)

  const medications = getMedicationsForPet(pet.id)
  return {
    auth_pattern: 'JWT Validation — same Bearer token, no extra consent needed',
    pet: { id: pet.id, name: pet.name, breed: pet.breed },
    medications,
    count: medications.length,
  }
}
