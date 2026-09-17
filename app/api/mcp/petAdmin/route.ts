/**
 * MCP Pet Admin endpoint — /api/mcp/petAdmin
 *
 * Serves pet tools for the TaskAgent on the PetSmart portal.
 * Auth0 patterns: JWT bearer, Token Exchange (RFC 8693), FGA, CIBA push.
 */

// Allow 55s: deletePetMedication polls Auth0 inline while the user approves the push
export const maxDuration = 55

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'

import { listPetsSchema, executeListPets } from '@/lib/tools/listPets'
import { listPetMedicationsSchema, executeListPetMedications } from '@/lib/tools/listPetMedications'
import { addPetMedicationSchema, executeAddPetMedication } from '@/lib/tools/addPetMedication'
import { refillPetMedicationSchema, executeRefillPetMedication } from '@/lib/tools/refillPetMedication'
import { deletePetMedicationSchema, executeDeletePetMedication } from '@/lib/tools/deletePetMedication'

const domain   = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

console.log('[mcp/petAdmin] config — domain:', domain, '| audience:', audience)

const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    console.warn('[mcp/petAdmin/verifyToken] no bearer token')
    return undefined
  }
  try {
    const rawPayload = JSON.parse(Buffer.from(bearerToken.split('.')[1], 'base64url').toString())
    console.log('[mcp/petAdmin/verifyToken] iss:', rawPayload.iss, '| aud:', rawPayload.aud)
  } catch { /* ignore */ }
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer:   `https://${domain}/`,
      audience,
    })
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean)
    console.log('[mcp/petAdmin/verifyToken] ✓ sub:', payload.sub, '| scopes:', scopes.join(' '))
    return {
      token:    bearerToken,
      clientId: (payload.azp as string | undefined) ?? '',
      scopes,
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch (err) {
    console.error('[mcp/petAdmin/verifyToken] ✗', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCtx(ctx: any, toolName: string) {
  const authInfo = ctx.http?.authInfo
  const sub      = authInfo?.extra?.['sub'] as string | undefined
  const token    = authInfo?.token
  if (!sub || !token) {
    console.warn(`[mcp/petAdmin/${toolName}] missing sub or token`)
    return null
  }
  console.log(`[mcp/petAdmin/${toolName}] sub: ${sub}`)
  return { sub, token, toolCallId: `mcp-${toolName}-${Date.now()}` }
}

function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: listPets — JWT bearer ─────────────────────────────────────────
    server.registerTool(
      'listPets',
      {
        title:       'List Pets',
        description: 'List all pets registered in this account. Requires a valid JWT bearer token.',
        inputSchema: listPetsSchema,
      },
      async (_params, ctx) => {
        console.log('[mcp/petAdmin/listPets] called')
        const mcpCtx = extractCtx(ctx, 'listPets')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity. Please log in to the portal.')
        const result = await executeListPets()
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      },
    )

    // ── Tool 2: listPetMedications — JWT bearer ───────────────────────────────
    server.registerTool(
      'listPetMedications',
      {
        title:       'List Pet Medications',
        description: 'List all medications for a specific pet by name (e.g. Max, Bella, Charlie).',
        inputSchema: listPetMedicationsSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/petAdmin/listPetMedications] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'listPetMedications')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeListPetMedications(params)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to list medications.'
          console.error('[mcp/petAdmin/listPetMedications] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 3: addPetMedication — JWT + Token Exchange (RFC 8693) ────────────
    server.registerTool(
      'addPetMedication',
      {
        title:       'Add Pet Medication',
        description:
          'Add a new medication for a pet. Uses RFC 8693 Token Exchange to obtain a ' +
          'petsmart.widget.com token with medication:write scope before creating the record.',
        inputSchema: addPetMedicationSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/petAdmin/addPetMedication] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'addPetMedication')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeAddPetMedication(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to add medication.'
          console.error('[mcp/petAdmin/addPetMedication] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 4: refillPetMedication — JWT + FGA ───────────────────────────────
    server.registerTool(
      'refillPetMedication',
      {
        title:       'Refill Pet Medication',
        description:
          'Refill a medication by ID. Uses Fine-Grained Authorization (FGA) to verify ' +
          'the user has owner access to the medication before processing the refill.',
        inputSchema: refillPetMedicationSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/petAdmin/refillPetMedication] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'refillPetMedication')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeRefillPetMedication(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to refill medication.'
          console.error('[mcp/petAdmin/refillPetMedication] error:', msg)
          return errorResponse(msg)
        }
      },
    )

    // ── Tool 5: deletePetMedication — JWT + CIBA push ─────────────────────────
    server.registerTool(
      'deletePetMedication',
      {
        title:       'Delete Pet Medication',
        description:
          "Permanently delete a medication record. Requires CIBA push approval on the user's " +
          'device before deletion. The push notification is sent inline — no client retry needed.',
        inputSchema: deletePetMedicationSchema,
      },
      async (params, ctx) => {
        console.log('[mcp/petAdmin/deletePetMedication] params:', JSON.stringify(params))
        const mcpCtx = extractCtx(ctx, 'deletePetMedication')
        if (!mcpCtx) return errorResponse('Unauthorized: missing user identity.')
        try {
          const result = await executeDeletePetMedication(params, mcpCtx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to delete medication.'
          console.error('[mcp/petAdmin/deletePetMedication] error:', msg)
          return errorResponse(msg)
        }
      },
    )
  },
  {
    serverInfo: { name: 'pet-admin-mcp-server', version: '1.0.0' },
  },
)

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: false,
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
