/**
 * In-memory pet and medication store.
 * In production, replace with a database.
 */

export interface Pet {
  id: string
  name: string
  species: string
  breed: string
  age: number
}

export interface Medication {
  id: string
  petId: string
  name: string
  dosage: string
  refills: number
  status: 'active' | 'pending_vet_approval' | 'discontinued'
}

const pets = new Map<string, Pet>([
  ['pet-001', { id: 'pet-001', name: 'Max',     species: 'Dog', breed: 'Labrador Retriever', age: 3 }],
  ['pet-002', { id: 'pet-002', name: 'Bella',   species: 'Cat', breed: 'Maine Coon',         age: 5 }],
  ['pet-003', { id: 'pet-003', name: 'Charlie', species: 'Dog', breed: 'Golden Retriever',   age: 1 }],
])

const medications = new Map<string, Medication>([
  ['med-101', { id: 'med-101', petId: 'pet-001', name: 'Heartgard Plus', dosage: '1 chew/month',       refills: 3, status: 'active' }],
  ['med-102', { id: 'med-102', petId: 'pet-001', name: 'Apoquel',        dosage: '16mg daily',          refills: 1, status: 'active' }],
  ['med-201', { id: 'med-201', petId: 'pet-002', name: 'Felimazole',     dosage: '2.5mg twice daily',   refills: 2, status: 'active' }],
])

export function listPets(): Pet[] {
  return Array.from(pets.values())
}

export function getPetByName(name: string): Pet | undefined {
  return Array.from(pets.values()).find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  )
}

export function getMedicationsForPet(petId: string): Medication[] {
  return Array.from(medications.values()).filter((m) => m.petId === petId)
}

export function getMedication(id: string): Medication | undefined {
  return medications.get(id)
}

export function addMedication(
  petId: string,
  name: string,
  dosage: string,
): Medication {
  const id = `med-${Date.now()}`
  const med: Medication = { id, petId, name, dosage, refills: 0, status: 'pending_vet_approval' }
  medications.set(id, med)
  return med
}

export function decrementRefill(id: string): Medication | null {
  const med = medications.get(id)
  if (!med || med.refills <= 0) return null
  med.refills -= 1
  return med
}

export function deleteMedication(id: string): Medication | null {
  const med = medications.get(id)
  if (!med) return null
  medications.delete(id)
  return med
}
