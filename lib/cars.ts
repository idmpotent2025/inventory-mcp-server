/**
 * In-memory used-car inventory.
 * Replace with a database in production.
 */

export type FuelType = 'gasoline' | 'hybrid' | 'electric' | 'diesel'
export type ListingStatus = 'available' | 'pending' | 'sold'

export interface Car {
  vin: string
  year: number
  make: string
  model: string
  trim: string
  mileage: number
  price: number
  color: string
  fuelType: FuelType
  mpg: number
  dealerName: string
  dealerCity: string
  dealerState: string
  status: ListingStatus
  carfaxSummary: string
}

const store = new Map<string, Car>([
  ['1HGCM82633A123456', {
    vin: '1HGCM82633A123456',
    year: 2022,
    make: 'Honda',
    model: 'Accord',
    trim: 'Sport 2.0T',
    mileage: 28_400,
    price: 27_995,
    color: 'Sonic Gray Pearl',
    fuelType: 'gasoline',
    mpg: 30,
    dealerName: 'Capital City Honda',
    dealerCity: 'Austin',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, no accidents, clean title, service records available',
  }],
  ['2T1BURHE0JC062890', {
    vin: '2T1BURHE0JC062890',
    year: 2021,
    make: 'Toyota',
    model: 'Corolla',
    trim: 'LE',
    mileage: 41_200,
    price: 21_500,
    color: 'Blizzard White',
    fuelType: 'gasoline',
    mpg: 32,
    dealerName: 'AutoNation Toyota',
    dealerCity: 'Dallas',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '2 owners, minor bumper repair 2022, clean title',
  }],
  ['5YJSA1E26MF123789', {
    vin: '5YJSA1E26MF123789',
    year: 2023,
    make: 'Tesla',
    model: 'Model S',
    trim: 'Long Range',
    mileage: 14_900,
    price: 68_990,
    color: 'Midnight Silver Metallic',
    fuelType: 'electric',
    mpg: 120, // MPGe
    dealerName: 'Tesla Certified Pre-Owned',
    dealerCity: 'Houston',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, no accidents, full self-driving hardware, battery health 98%',
  }],
  ['1G1ZD5ST4JF208321', {
    vin: '1G1ZD5ST4JF208321',
    year: 2022,
    make: 'Chevrolet',
    model: 'Malibu',
    trim: 'LT',
    mileage: 35_600,
    price: 19_750,
    color: 'Mosaic Black',
    fuelType: 'gasoline',
    mpg: 29,
    dealerName: 'Carvana',
    dealerCity: 'San Antonio',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, no accidents, clean title',
  }],
  ['3CZRU6H50JM730017', {
    vin: '3CZRU6H50JM730017',
    year: 2021,
    make: 'Honda',
    model: 'HR-V',
    trim: 'EX AWD',
    mileage: 52_100,
    price: 23_400,
    color: 'Lunar Silver Metallic',
    fuelType: 'gasoline',
    mpg: 28,
    dealerName: 'Hendrick Honda',
    dealerCity: 'Charlotte',
    dealerState: 'NC',
    status: 'pending',
    carfaxSummary: '1 owner, oil change records, clean title, slight hail damage repaired',
  }],
  ['WBAJA7C51JG896134', {
    vin: 'WBAJA7C51JG896134',
    year: 2022,
    make: 'BMW',
    model: '5 Series',
    trim: '530i xDrive',
    mileage: 22_300,
    price: 49_500,
    color: 'Alpine White',
    fuelType: 'gasoline',
    mpg: 26,
    dealerName: 'BMW of Austin',
    dealerCity: 'Austin',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, CPO warranty remaining, no accidents, full service history',
  }],
  ['JN1AZ4EH2FM730081', {
    vin: 'JN1AZ4EH2FM730081',
    year: 2021,
    make: 'Nissan',
    model: 'LEAF',
    trim: 'SV Plus',
    mileage: 18_700,
    price: 24_800,
    color: 'Deep Blue Pearl',
    fuelType: 'electric',
    mpg: 99, // MPGe
    dealerName: 'Nissan of Lewisville',
    dealerCity: 'Lewisville',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, no accidents, battery health 95%, clean title',
  }],
  ['KM8J3CA46LU088901', {
    vin: 'KM8J3CA46LU088901',
    year: 2023,
    make: 'Hyundai',
    model: 'Tucson',
    trim: 'Hybrid SEL',
    mileage: 11_200,
    price: 33_200,
    color: 'Amazon Gray',
    fuelType: 'hybrid',
    mpg: 38,
    dealerName: 'Classic Hyundai',
    dealerCity: 'Beaumont',
    dealerState: 'TX',
    status: 'available',
    carfaxSummary: '1 owner, no accidents, clean title, remaining factory warranty',
  }],
])

export interface CarSearchFilters {
  make?: string
  model?: string
  yearMin?: number
  yearMax?: number
  priceMin?: number
  priceMax?: number
  mileageMax?: number
  fuelType?: FuelType
  state?: string
}

export function searchCars(filters: CarSearchFilters): Car[] {
  return Array.from(store.values()).filter((car) => {
    if (car.status === 'sold') return false
    if (filters.make && !car.make.toLowerCase().includes(filters.make.toLowerCase())) return false
    if (filters.model && !car.model.toLowerCase().includes(filters.model.toLowerCase())) return false
    if (filters.yearMin !== undefined && car.year < filters.yearMin) return false
    if (filters.yearMax !== undefined && car.year > filters.yearMax) return false
    if (filters.priceMin !== undefined && car.price < filters.priceMin) return false
    if (filters.priceMax !== undefined && car.price > filters.priceMax) return false
    if (filters.mileageMax !== undefined && car.mileage > filters.mileageMax) return false
    if (filters.fuelType && car.fuelType !== filters.fuelType) return false
    if (filters.state && car.dealerState.toLowerCase() !== filters.state.toLowerCase()) return false
    return true
  })
}

export function getCarByVin(vin: string): Car | undefined {
  return store.get(vin)
}
