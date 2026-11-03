/**
 * MCP Auto Market endpoint — /api/mcp/autoMarket
 *
 * Used car marketplace tools (CapitalOne Auto Navigator / Carvana style).
 *
 * Auth0 patterns per tool:
 *   Public (no auth):         help, listCars, getCarDetails
 *   JWT bearer:               getWishlist
 *   JWT + FGA:                addToWishlist, removeFromWishlist
 *   JWT + RFC 8693 OBO:       checkPreApproval
 *   JWT + CIBA push:          submitLoanApplication
 *   JWT + Token Vault:        scheduleTestDrive
 */

// Allow 55s: submitLoanApplication polls Auth0 CIBA inline while the user approves the push
export const maxDuration = 55

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'

import { autoMarketHelpSchema, executeAutoMarketHelp } from '@/lib/tools/autoMarketHelp'
import { searchCarsSchema, executeSearchCars } from '@/lib/tools/searchCars'
import { getCarDetailsSchema, executeGetCarDetails } from '@/lib/tools/getCarDetails'
import { getWishlistSchema, executeGetWishlist } from '@/lib/tools/getWishlist'
import { addToWishlistSchema, executeAddToWishlist } from '@/lib/tools/addToWishlist'
import { removeFromWishlistSchema, executeRemoveFromWishlist } from '@/lib/tools/removeFromWishlist'
import { checkPreApprovalSchema, executeCheckPreApproval } from '@/lib/tools/checkPreApproval'
import { submitLoanApplicationSchema, executeSubmitLoanApplication } from '@/lib/tools/submitLoanApplication'
import { scheduleTestDriveSchema, executeScheduleTestDrive } from '@/lib/tools/scheduleTestDrive'

const domain   = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

console.log('[mcp/autoMarket] config — domain:', domain, '| audience:', audience)

const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  try {
    const rawPayload = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64url').toString())
    console.log('[mcp/autoMarket/verifyToken] iss:', rawPayload.iss, '| aud:', rawPayload.aud)
  } catch { /* ignore */ }
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer:   `https://${domain}/`,
      audience,
    })
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean)
    console.log('[mcp/autoMarket/verifyToken] ✓ sub:', payload.sub, '| scopes:', scopes.join(' '))
    return {
      token:    bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes,
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch (err) {
    console.error('[mcp/autoMarket/verifyToken] ✗', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCtx(ctx: any, toolName: string) {
  const authInfo = ctx.http?.authInfo
  const sub      = authInfo?.extra?.['sub'] as string | undefined
  const token    = authInfo?.token
  if (!sub || !token) {
    console.warn(`[mcp/autoMarket/${toolName}] missing sub or token`)
    return null
  }
  console.log(`[mcp/autoMarket/${toolName}] sub: ${sub}`)
  return { sub, token, toolCallId: `mcp-${toolName}-${Date.now()}` }
}

function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: help — public ─────────────────────────────────────────────────
    server.registerTool(
      'help',
      {
        title:       'Help',
        description: 'Describe all available tools, their purpose, and the Auth0 pattern each one demonstrates.',
        inputSchema: autoMarketHelpSchema,
      },
      async (_params, _ctx) => {
        const result = executeAutoMarketHelp({})
        return { content: [{ type: 'text' as const, text: result.text }] }
      },
    )

    // ── Tool 2: listCars — public ─────────────────────────────────────────────
    server.registerTool(
      'listCars',
      {
        title:       'List Cars',
        description:
          'Search used car listings by make, model, year, price, mileage, fuel type, or dealer state. ' +
          'No login required.',
        inputSchema: searchCarsSchema,
      },
      async (params, _ctx) => {
        console.log('[mcp/autoMarket/listCars] params:', JSON.stringify(params))
        try {
          const result = executeSearchCars(params)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Search failed.'
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 3: getCarDetails — public ────────────────────────────────────────
    server.registerTool(
      'getCarDetails',
      {
        title:       'Get Car Details',
        description:
          'Get full details and Carfax summary for a vehicle by VIN. No login required.',
        inputSchema: getCarDetailsSchema,
      },
      async (params, _ctx) => {
        console.log('[mcp/autoMarket/getCarDetails] vin:', params.vin)
        try {
          const result = executeGetCarDetails(params)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch car details.'
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: getWishlist — JWT bearer ──────────────────────────────────────
    server.registerTool(
      'getWishlist',
      {
        title:       'Get Wishlist',
        description: 'View your saved cars. Requires a valid JWT bearer token.',
        inputSchema: getWishlistSchema,
      },
      async (_params, ctx) => {
        const mcpCtx = extractCtx(ctx, 'getWishlist')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to view your wishlist.')
        const result = executeGetWishlist({}, mcpCtx)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      },
    )

    // ── Tool 5: addToWishlist — JWT + FGA (can_update wishlist:default) ───────
    server.registerTool(
      'addToWishlist',
      {
        title:       'Add to Wishlist',
        description:
          'Save a car to your wishlist. Requires JWT + FGA check: ' +
          'user must have can_update on wishlist:default.',
        inputSchema: addToWishlistSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/autoMarket/addToWishlist] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'addToWishlist')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to manage your wishlist.')
        try {
          const result = await executeAddToWishlist(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to add car to wishlist.'
          console.error('[mcp/autoMarket/addToWishlist] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 6: removeFromWishlist — JWT + FGA (can_update wishlist:default) ──
    server.registerTool(
      'removeFromWishlist',
      {
        title:       'Remove from Wishlist',
        description:
          'Remove a saved car from your wishlist. Requires JWT + FGA check: ' +
          'user must have can_update on wishlist:default.',
        inputSchema: removeFromWishlistSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/autoMarket/removeFromWishlist] vin:', params.vin)
        const mcpCtx = extractCtx(ctx, 'removeFromWishlist')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to manage your wishlist.')
        try {
          const result = await executeRemoveFromWishlist(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to remove car from wishlist.'
          console.error('[mcp/autoMarket/removeFromWishlist] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 7: checkPreApproval — JWT + RFC 8693 OBO ─────────────────────────
    server.registerTool(
      'checkPreApproval',
      {
        title:       'Check Pre-Approval',
        description:
          'Get pre-approved loan offers for a vehicle. Uses RFC 8693 On-Behalf-Of token exchange ' +
          'to obtain a lender.autonav.com token with read:preapprovals scope.',
        inputSchema: checkPreApprovalSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/autoMarket/checkPreApproval] vin:', params.vin)
        const mcpCtx = extractCtx(ctx, 'checkPreApproval')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to check pre-approval offers.')
        try {
          const result = await executeCheckPreApproval(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to check pre-approval.'
          console.error('[mcp/autoMarket/checkPreApproval] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 8: submitLoanApplication — JWT + CIBA push ───────────────────────
    server.registerTool(
      'submitLoanApplication',
      {
        title:       'Submit Loan Application',
        description:
          'Submit a loan application for a vehicle. A push notification is sent to your enrolled ' +
          'device for confirmation (CIBA). No client retry needed — approval is polled inline.',
        inputSchema: submitLoanApplicationSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/autoMarket/submitLoanApplication] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'submitLoanApplication')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to submit a loan application.')
        try {
          const result = await executeSubmitLoanApplication(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to submit loan application.'
          console.error('[mcp/autoMarket/submitLoanApplication] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 9: scheduleTestDrive — JWT + Token Vault (Google Calendar) ───────
    server.registerTool(
      'scheduleTestDrive',
      {
        title:       'Schedule Test Drive',
        description:
          'Book a test drive appointment at the dealer. Uses Auth0 Token Vault to exchange ' +
          "the user's marketplace token for their vaulted Google OAuth token, then creates a " +
          'Google Calendar event. User must have connected their Google account.',
        inputSchema: scheduleTestDriveSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/autoMarket/scheduleTestDrive] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'scheduleTestDrive')
        if (!mcpCtx) return errorResponse('Unauthorized: please log in to schedule a test drive.')
        try {
          const result = await executeScheduleTestDrive(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to schedule test drive.'
          if (msg === 'GOOGLE_NOT_CONNECTED') {
            return errorResponse(
              'Your Google account is not connected. Please link your Google Calendar in account settings and try again.',
            )
          }
          console.error('[mcp/autoMarket/scheduleTestDrive] error:', msg)
          return errorResponse(msg)
        }
      },
    )
  },
  {
    serverInfo: { name: 'auto-market-mcp-server', version: '1.0.0' },
  },
)

// required: false — public tools (help, listCars, getCarDetails) work without a token
const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: false,
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
