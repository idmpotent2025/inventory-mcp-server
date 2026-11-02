import { z } from 'zod'
import { getCarByVin } from '@/lib/cars'

export const getCarDetailsSchema = z.object({
  vin: z.string().describe('Vehicle Identification Number (17-character VIN)'),
})

export type GetCarDetailsInput = z.infer<typeof getCarDetailsSchema>

export function executeGetCarDetails(params: GetCarDetailsInput) {
  const car = getCarByVin(params.vin)
  if (!car) throw new Error(`No listing found for VIN "${params.vin}".`)
  return { car }
}
