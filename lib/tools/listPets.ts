import { z } from 'zod'
import { listPets } from '@/lib/pets'

export const listPetsSchema = z.object({})

export async function executeListPets() {
  const pets = listPets()
  return {
    auth_pattern: 'JWT Validation — Bearer token verified via Auth0 JWKS endpoint',
    pets,
    count: pets.length,
  }
}
