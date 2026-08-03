import { z } from 'zod'
import { buildOpenFgaClient } from '@auth0/ai'
import { AsyncAuthorizerBase } from '@auth0/ai/AsyncAuthorization'
import { TokenVaultAuthorizerBase, getCredentialsFromTokenVault, SUBJECT_TOKEN_TYPES } from '@auth0/ai/TokenVault'
import { MemoryStore } from '@auth0/ai/stores'
import { addItem } from '@/lib/inventory'

export const addItemSchema = z.object({
  name: z.string().describe('Name of the new inventory item'),
  quantity: z.number().int().min(0).describe('Initial stock quantity'),
  price: z.number().min(0).describe('Unit price in USD'),
})

export type AddItemInput = z.infer<typeof addItemSchema>

/**
 * MCP tool execution context — carries identity and call metadata
 * extracted from the Auth0 bearer token on the incoming MCP request.
 */
export type MCPToolContext = {
  /** JWT `sub` claim — the authenticated user's ID */
  sub: string
  /** Raw bearer access token — used as OBO subject token for TokenVault */
  token: string
  /** Unique identifier for this tool invocation */
  toolCallId: string
}

type ToolArgs = [AddItemInput, MCPToolContext]

// ── Module-level singletons ───────────────────────────────────────────────────
//
// The MemoryStore persists within a warm Vercel instance but resets on cold
// start. For production, replace with @auth0/ai-redis (Vercel KV / Upstash).
//
const store = new MemoryStore()

// Auth0 M2M client config — reads from env at module load time.
// AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET must be set in Vercel.
const auth0 = {
  domain: process.env.AUTH0_DOMAIN ?? '',
  clientId: process.env.AUTH0_CLIENT_ID ?? '',
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
}

// ── Context extractor ─────────────────────────────────────────────────────────
//
// Maps MCP tool args to the ToolCallContext expected by @auth0/ai authorizers.
//
const getContext = (_params: AddItemInput, ctx: MCPToolContext) => ({
  threadID: ctx.sub,
  toolCallID: ctx.toolCallId,
  toolName: 'addItem',
})

// ── Step 3 — Core execution ───────────────────────────────────────────────────
//
// Runs after FGA + CIBA + TokenVault checks all pass.
// The TokenVault authorizer populates asyncLocalStorage with the Google token
// before calling this function.
//
const coreExecute = async (params: AddItemInput, ctx: MCPToolContext) => {
  const item = addItem(params.name, params.quantity, params.price, ctx.sub)

  // Send Gmail notification using the federated Google token from TokenVault (OBO).
  const googleToken = getCredentialsFromTokenVault()?.accessToken
  const recipient = process.env.NOTIFICATION_EMAIL_TO
  if (googleToken && recipient) {
    const subject = 'New Inventory Item Added'
    const body = `New item added: "${params.name}" — qty ${params.quantity}, $${params.price}`
    const mime = [
      `To: ${recipient}`,
      'Content-Type: text/plain; charset=utf-8',
      `Subject: ${subject}`,
      '',
      body,
    ].join('\r\n')
    const raw = Buffer.from(mime).toString('base64url')
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }).catch(() => {/* non-fatal */})
  }

  return { success: true, item }
}

// ── Step 2 — Token Vault / OBO ────────────────────────────────────────────────
//
// Exchanges the user's MCP access token (On-Behalf-Of / RFC 8693 token
// exchange) for a federated Google token stored in Auth0 Token Vault.
// The resulting Google token is placed in asyncLocalStorage for coreExecute.
//
const tokenVaultAuthorizer = new TokenVaultAuthorizerBase<ToolArgs>(auth0, {
  store,
  connection: 'google-oauth2',
  scopes: ['https://www.googleapis.com/auth/gmail.send'],
  // OBO: provide the user's bearer token as the subject token to exchange
  accessToken: (_params, ctx) => ctx.token,
  subjectTokenType: SUBJECT_TOKEN_TYPES.SUBJECT_TYPE_ACCESS_TOKEN,
})
const withTokenVault = tokenVaultAuthorizer.protect(getContext, coreExecute)

// ── Step 1 wrapper — CIBA step-up ─────────────────────────────────────────────
//
// Sends a push notification to the user's device requesting approval.
// On the first call the tool throws AuthorizationPendingInterrupt — the MCP
// client should surface this to the user and retry once they approve.
// `credentialsContext: "thread"` scopes the approval to the user's thread so
// retries within the same session find the pending/completed request.
//
const cibaAuthorizer = new AsyncAuthorizerBase<ToolArgs>(auth0, {
  store,
  scopes: ['openid'],
  userID: (_params, ctx) => ctx.sub,
  bindingMessage: (params) => `Approve adding "${params.name}" to inventory`,
  audience: process.env.AUTH0_AUDIENCE,
  credentialsContext: 'thread',
})
const withCIBA = cibaAuthorizer.protect(getContext, withTokenVault)

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Executes the addItem MCP tool with full Auth0 for MCP protection:
 *
 *   1. FGA   — verifies `user:<sub> writer inventory:default`
 *   2. CIBA  — requires out-of-band push approval before proceeding
 *   3. OBO   — exchanges user access token for Google token (Token Vault)
 *   4. Core  — adds the item and sends a Gmail notification
 */
export async function executeAddItem(params: AddItemInput, ctx: MCPToolContext) {
  // 1. FGA — direct OpenFGA client call; no wrapper needed
  const fgaClient = buildOpenFgaClient()
  const { allowed } = await fgaClient.check({
    user: `user:${ctx.sub}`,
    relation: 'writer',
    object: 'inventory:default',
  })
  if (!allowed) {
    throw new Error('Forbidden: you do not have writer access to this inventory.')
  }

  // 2 → 3 → 4: CIBA step-up → TokenVault/OBO → coreExecute
  return withCIBA(params, ctx)
}
