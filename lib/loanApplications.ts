/**
 * In-memory loan application store.
 * Replace with a database + lender API integration in production.
 */

export type ApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'denied'

export interface LoanApplication {
  applicationId: string
  sub: string
  vin: string
  requestedAmount: number
  termMonths: number
  status: ApplicationStatus
  submittedAt: string
  apr?: number
  monthlyPayment?: number
}

export interface PreApprovalOffer {
  offerId: string
  maxAmount: number
  apr: number
  termMonths: number
  monthlyPaymentEstimate: number
  expiresAt: string
}

const applicationStore = new Map<string, LoanApplication>()

export function getPreApprovalOffers(_sub: string, vehiclePrice: number): PreApprovalOffer[] {
  const base = vehiclePrice * 0.9
  return [
    {
      offerId: `offer-60mo-${Date.now()}`,
      maxAmount: Math.round(base),
      apr: 6.49,
      termMonths: 60,
      monthlyPaymentEstimate: Math.round((base * (6.49 / 100 / 12)) / (1 - Math.pow(1 + 6.49 / 100 / 12, -60))),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
    },
    {
      offerId: `offer-72mo-${Date.now() + 1}`,
      maxAmount: Math.round(base),
      apr: 7.15,
      termMonths: 72,
      monthlyPaymentEstimate: Math.round((base * (7.15 / 100 / 12)) / (1 - Math.pow(1 + 7.15 / 100 / 12, -72))),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
    },
    {
      offerId: `offer-48mo-${Date.now() + 2}`,
      maxAmount: Math.round(base * 0.85),
      apr: 5.99,
      termMonths: 48,
      monthlyPaymentEstimate: Math.round((base * 0.85 * (5.99 / 100 / 12)) / (1 - Math.pow(1 + 5.99 / 100 / 12, -48))),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0],
    },
  ]
}

export function submitLoanApplication(
  sub: string,
  vin: string,
  requestedAmount: number,
  termMonths: number,
  apr: number,
): LoanApplication {
  const applicationId = `app-${Date.now()}`
  const monthlyRate = apr / 100 / 12
  const monthlyPayment = Math.round(
    (requestedAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths)),
  )
  const application: LoanApplication = {
    applicationId,
    sub,
    vin,
    requestedAmount,
    termMonths,
    apr,
    monthlyPayment,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  }
  applicationStore.set(applicationId, application)
  return application
}

export function getLoanApplications(sub: string): LoanApplication[] {
  return Array.from(applicationStore.values()).filter((a) => a.sub === sub)
}
