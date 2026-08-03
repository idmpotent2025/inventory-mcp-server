/**
 * MCP Server route – hosted on Vercel at /api/mcp
 *
 * Auth0 for MCP capabilities demonstrated on the `addItem` tool:
 *   1. withMcpAuth — validates Auth0 JWT bearer token on every request
 *   2. FGA         — checks writer relation in Auth0 FGA
 *   3. CIBA        — requires out-of-band push approval (AsyncAuthorizerBase)
 *   4. TokenVault  — fetches federated Slack token (TokenVaultAuthorizerBase)
 *   5. OBO         — user access token exchanged for Slack token (RFC 8693)
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { z } from 'zod'

import { executeListInventory } from '@/lib/tools/listInventory'
import { addItemSchema, executeAddItem, type MCPToolContext } from '@/lib/tools/addItem'
import { AsyncAuthorizationInterrupt } from '@auth0/ai/interrupts'

// ── Auth0 JWT verification ────────────────────────────────────────────────────

const domain = process.env.AUTH0_DOMAIN!
const audience = process.env.AUTH0_AUDIENCE!

// Cache the JWKS remote key set (re-used across warm invocations)
const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `https://${domain}/`,
      audience,
    })
    return {
      token: bearerToken,
      // clientId is required in AuthInfo; azp = authorized party (OAuth client ID)
      clientId: (payload.azp as string | undefined) ?? '',
      scopes: ((payload.scope as string) ?? '').split(' ').filter(Boolean),
      // AuthInfo has no sub field — store it in extra for downstream access
      extra: { sub: payload.sub, ...payload } as Record<string, unknown>,
    }
  } catch {
    return undefined
  }
}

// ── MCP server definition ─────────────────────────────────────────────────────

const mcpHandler = createMcpHandler(
  (server) => {
    // ── Tool 1: listInventory ─────────────────────────────────────────────────
    // Authorization: bearer token only (enforced by withMcpAuth below).
    server.registerTool(
      'listInventory',
      {
        title: 'List Inventory',
        description: 'List all items currently in the inventory.',
        inputSchema: z.object({}),
      },
      async () => {
        const result = await executeListInventory()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      },
    )

    // ── Tool 2: addItem ───────────────────────────────────────────────────────
    // Authorization: bearer token + FGA writer check + CIBA step-up +
    //               TokenVault OBO (Slack token exchange).
    server.registerTool(
      'addItem',
      {
        title: 'Add Inventory Item',
        description:
          'Add a new item to the inventory. Requires FGA writer permission, CIBA ' +
          'push approval, and posts a Slack notification via Auth0 Token Vault (OBO).',
        inputSchema: addItemSchema,
      },
      async (params, ctx) => {
        const authInfo = ctx.http?.authInfo
        const sub = authInfo?.extra?.['sub'] as string | undefined
        const token = authInfo?.token

        if (!sub || !token) {
          return {
            content: [{ type: 'text' as const, text: 'Unauthorized: missing user identity.' }],
            isError: true,
          }
        }

        const mcpCtx: MCPToolContext = {
          sub,
          token,
          toolCallId: `mcp-add-${Date.now()}`,
        }

        try {
          const result = await executeAddItem(params, mcpCtx)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          }
        } catch (err: unknown) {
          // CIBA interrupt — user must approve the push notification and retry
          if (err instanceof AsyncAuthorizationInterrupt) {
            return {
              content: [{
                type: 'text' as const,
                text: `Authorization pending: ${err.message}. Please approve the request on your device and retry.`,
              }],
              isError: true,
            }
          }
          const msg = err instanceof Error ? err.message : 'Failed to add item.'
          return {
            content: [{ type: 'text' as const, text: msg }],
            isError: true,
          }
        }
      },
    )
  },
  {
    serverInfo: {
      name: 'inventory-mcp-server',
      version: '1.0.0',
    },
  },
)

// ── Wrap with Auth0 JWT bearer token verification ─────────────────────────────

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: true,
  requiredScopes: ['read:inventory'],
  resourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000',
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
