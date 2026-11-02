import { z } from 'zod'

export const autoMarketHelpSchema = z.object({})

export type AutoMarketHelpInput = z.infer<typeof autoMarketHelpSchema>

const HELP_TEXT = `
Auto Market MCP Server — available tools:

PUBLIC (no login required):
  • searchCars            Search listings by make, model, year, price, mileage, fuel type, or state.
  • getCarDetails         Get full details + Carfax summary for a VIN.

REQUIRES LOGIN (JWT bearer token):
  • getWishlist           View your saved cars.

REQUIRES LOGIN + FGA (can_update on wishlist:default):
  • addToWishlist         Save a car to your wishlist.
  • removeFromWishlist    Remove a car from your wishlist.

REQUIRES LOGIN + RFC 8693 OBO (lender token exchange):
  • checkPreApproval      Get pre-approved loan offers for a vehicle.

REQUIRES LOGIN + CIBA push approval:
  • submitLoanApplication Submit a loan application. A push notification is sent to your device for confirmation.

REQUIRES LOGIN + Token Vault (Google Calendar):
  • scheduleTestDrive     Book a test drive at the dealer. Adds the appointment to your Google Calendar.

Tip: mutations that require Auth0 authorization (FGA, OBO, CIBA, Token Vault) will guide you if
additional steps are needed. For CIBA tools, approve the push notification on your enrolled device promptly.
`.trim()

export function executeAutoMarketHelp(_params: AutoMarketHelpInput): { text: string } {
  return { text: HELP_TEXT }
}
