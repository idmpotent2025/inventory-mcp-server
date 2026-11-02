import { z } from 'zod'
import { searchCars, type FuelType } from '@/lib/cars'

export const searchCarsSchema = z.object({
  make: z.string().optional().describe('Car make (e.g. Honda, Toyota, Tesla)'),
  model: z.string().optional().describe('Car model (e.g. Accord, Corolla, Model S)'),
  yearMin: z.number().int().optional().describe('Minimum model year (e.g. 2020)'),
  yearMax: z.number().int().optional().describe('Maximum model year (e.g. 2024)'),
  priceMin: z.number().optional().describe('Minimum price in USD'),
  priceMax: z.number().optional().describe('Maximum price in USD'),
  mileageMax: z.number().optional().describe('Maximum mileage'),
  fuelType: z.enum(['gasoline', 'hybrid', 'electric', 'diesel']).optional().describe('Fuel type filter'),
  state: z.string().optional().describe('Two-letter dealer state code (e.g. TX, CA)'),
})

export type SearchCarsInput = z.infer<typeof searchCarsSchema>

export function executeSearchCars(params: SearchCarsInput) {
  const results = searchCars({
    make: params.make,
    model: params.model,
    yearMin: params.yearMin,
    yearMax: params.yearMax,
    priceMin: params.priceMin,
    priceMax: params.priceMax,
    mileageMax: params.mileageMax,
    fuelType: params.fuelType as FuelType | undefined,
    state: params.state,
  })
  return { listings: results, count: results.length }
}
