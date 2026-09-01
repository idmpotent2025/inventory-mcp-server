================================================================================
  MCP SERVER DEMO — Auth0 CIAM Patterns for the Model Context Protocol
================================================================================

VERCEL DEPLOYMENT  : https://inventory-mcp-server-nine.vercel.app
GITHUB             : https://github.com/idmpotent2025/inventory-mcp-server
MCP ENDPOINTS      : /api/mcp              (original, backward compat)
                     /api/mcp/invoiceAdmin (TaskAgent — invoice tools)
                     /api/mcp/delegatedAdmin (TeamAgent — member tools, org_admin only)
TOOLS              : 11 registered tools (split across endpoints)
BUILT WITH         : Next.js 14 · TypeScript · @modelcontextprotocol/sdk · Zod · Auth0


────────────────────────────────────────────────────────────────────────────────
  SECTION 1 — WHY THIS MCP SERVER
────────────────────────────────────────────────────────────────────────────────

This server exists to demonstrate how Auth0's CIAM (Customer Identity and Access
Management) stack integrates with the Model Context Protocol (MCP).

MCP lets AI agents call external tools. When those tools touch real business data
— invoices, member records, payment flows — you need more than a simple API key.
You need the same identity and authorization controls you'd apply to any
first-class application: verified user identity, fine-grained permissions, step-up
authentication for sensitive actions, and auditable token delegation.

This server shows four distinct Auth0 security patterns applied to MCP tools,
using two domains (invoices and portal members) as concrete examples:

  1. JWT Bearer Auth      — prove who the caller is (every protected tool)
  2. Fine-Grained Authz  — prove the caller is allowed to do THIS thing (FGA)
  3. CIBA Push Approval  — require out-of-band device approval for risky ops
  4. RFC 8693 OBO Token  — exchange the caller's token for a downstream-scoped
                           token before calling a third-party service

The goal is a reference server that a developer, sales engineer, or architect can
point an AI agent at and immediately see Auth0 identity patterns in action —
without needing a real ERP, CRM, or billing system behind it.


────────────────────────────────────────────────────────────────────────────────
  SECTION 2 — HOW IT IS LAID OUT
────────────────────────────────────────────────────────────────────────────────

ROUTES
──────

  GET/POST  /api/mcp
      Original combined MCP endpoint. Kept for backward compatibility.
      Exposes all 11 tools (both invoice and member domains) in one endpoint.
      All requests except the /help tool require a valid Bearer token.

  GET/POST  /api/mcp/invoiceAdmin
      TaskAgent endpoint. Invoice domain only (7 tools: help, listInvoices,
      addInvoice, notifyViaGmail, deleteInvoice, payInvoice,
      rollbackDeleteInvoice). Used by the GlobalPartnerPortal TaskAgent page.
      maxDuration = 55 (inline CIBA polling).

  GET/POST  /api/mcp/delegatedAdmin
      TeamAgent endpoint. Member management domain only (5 tools: help,
      listMembers, inviteMember, resetPassword, deactivateMember). Every
      tool except /help additionally enforces the org_admin role from the
      https://globalpartnerportal.com/roles JWT claim (set via Auth0 Post
      Login Action). Used by the GlobalPartnerPortal TeamAgent page.
      maxDuration = 55 (inline CIBA polling).

  GET  /.well-known/oauth-authorization-server
      OAuth 2.0 Authorization Server metadata (RFC 8414). Advertises the
      Auth0 tenant's authorization_endpoint, token_endpoint, and supported
      grant types so MCP clients can auto-discover how to obtain tokens.

  GET  /.well-known/oauth-protected-resource
      OAuth 2.0 Protected Resource metadata (RFC 9470). Tells MCP clients
      which authorization server protects this resource, and what scopes
      or audiences are required to call it.

  GET  /README.txt
      This file. Static asset served from the public/ directory.


DATA STORES (in-memory, seeded on cold start)
─────────────────────────────────────────────

  lib/invoices.ts   — 5 invoices (INV-001 … INV-005), statuses: draft/pending/paid/overdue
  lib/inventory.ts  — inventory items with quantity and price
  lib/members.ts    — 5 portal members (mbr-001 … mbr-005), roles: admin/editor/viewer,
                      statuses: active/inactive/invited

  All stores are Maps held in module scope. They reset on Vercel cold start.
  rollbackDeleteInvoice restores invoice state without a cold start.


TOOL FILES
──────────

  lib/tools/help.ts               — unauthenticated help text
  lib/tools/listInvoices.ts       — JWT only
  lib/tools/addInvoice.ts         — FGA check
  lib/tools/deleteInvoice.ts      — CIBA push
  lib/tools/payInvoice.ts         — RFC 8693 token exchange (payments.widget.com)
  lib/tools/notifyInvoice.ts      — Auth0 Token Vault (Google OAuth OBO)
  lib/tools/rollbackDelete.ts     — JWT only, test-reset utility
  lib/tools/listMembers.ts        — JWT only
  lib/tools/inviteMember.ts       — FGA check
  lib/tools/resetPassword.ts      — CIBA push
  lib/tools/deactivateMember.ts   — RFC 8693 token exchange (admin.widget.com)

Each tool file exports: a Zod schema (inputSchema), an execute function, and
a TypeScript input type inferred from the schema.

Tools are wired in three route files using server.registerTool(...):
  app/api/mcp/route.ts               — all 11 tools (original combined endpoint)
  app/api/mcp/invoiceAdmin/route.ts  — 7 invoice tools (TaskAgent)
  app/api/mcp/delegatedAdmin/route.ts — 5 member tools (TeamAgent)


TOOL REGISTRY (all 11 tools)
─────────────────────────────

  /api/mcp/invoiceAdmin — TaskAgent (7 tools)
  ─── ───────────────────────  ──────────────────────────────────────
  1   help                     None — open to unauthenticated callers
  2   listInvoices             JWT bearer token
  3   addInvoice               JWT + Auth0 FGA (writer on invoices:invoiceA)
  4   deleteInvoice            JWT + CIBA push approval
  5   payInvoice               JWT + RFC 8693 OBO → payments.widget.com
  6   notifyViaGmail           JWT + Auth0 Token Vault → Google OAuth OBO
  7   rollbackDeleteInvoice    JWT only (test reset — restores deleted invoices)

  /api/mcp/delegatedAdmin — TeamAgent (5 tools, org_admin role required)
  ─── ───────────────────────  ──────────────────────────────────────
  1   help                     None — open to unauthenticated callers
  2   listMembers              JWT + org_admin role claim
  3   inviteMember             JWT + org_admin role + Auth0 FGA (writer on members:default)
  4   resetPassword            JWT + org_admin role + CIBA push approval
  5   deactivateMember         JWT + org_admin role + RFC 8693 OBO → admin.widget.com

  /api/mcp — original combined endpoint (all 11 tools, backward compat)
  See tool files in lib/tools/ for the full list.


────────────────────────────────────────────────────────────────────────────────
  SECTION 3 — HOW THE TOOLS ARE IMPLEMENTED
────────────────────────────────────────────────────────────────────────────────

PATTERN 0 — UNPROTECTED (help)
───────────────────────────────
Tool: help

The /help tool is registered without a JWT guard. It returns a plain text
description of all available tools and their required auth context. Useful for
AI agents that call the server without a token first to discover what it offers.

Implementation:
  - No withMcpAuth wrapper for this one registration
  - Returns static markdown-formatted text
  - Safe: read-only, no data access


PATTERN 1 — JWT BEARER (listInvoices, listMembers, rollbackDeleteInvoice)
──────────────────────────────────────────────────────────────────────────
Tools: listInvoices · listMembers · rollbackDeleteInvoice

Every request to /api/mcp is protected by withMcpAuth from @auth0/ai-mcp,
which validates the Bearer token against the Auth0 JWKS endpoint before the
MCP handler runs. If the token is missing or invalid, the request is rejected
with 401 before any tool code executes.

Inside each tool callback, the authenticated identity is extracted:

  function extractCtx(ctx, toolName): MCPToolContext | null {
    const sub  = ctx.http?.authInfo?.token?.sub
    const token = ctx.http?.authInfo?.token?.jwt
    return sub && token ? { sub, token, toolCallId } : null
  }

If extractCtx returns null, the tool returns a plain-text error and no data
is accessed. This provides defense-in-depth even if the middleware is bypassed.

Env vars required: AUTH0_DOMAIN, AUTH0_AUDIENCE


PATTERN 2 — FINE-GRAINED AUTHORIZATION / FGA (addInvoice, inviteMember)
─────────────────────────────────────────────────────────────────────────
Tools: addInvoice · inviteMember

After JWT validation, the tool asks Auth0 FGA whether the specific user has
the required relation on the specific resource:

  addInvoice:    user:<sub>  writer  invoices:invoiceA
  inviteMember:  user:<sub>  writer  members:default

Implementation (inviteMember example):

  const fgaClient = buildOpenFgaClient()       // uses FGA_STORE_ID, FGA_CLIENT_ID, FGA_CLIENT_SECRET
  const { allowed } = await fgaClient.check({
    user:     `user:${ctx.sub}`,
    relation: 'writer',
    object:   'members:default',
  })
  if (!allowed) throw new Error('Forbidden: you do not have permission to invite members.')
  // proceed with addMember(...)

The FGA tuple must be pre-written in the Auth0 FGA store for the check to pass.
The tool does not create the tuple — it only reads it.

Env vars required: FGA_STORE_ID, FGA_CLIENT_ID, FGA_CLIENT_SECRET
Optional overrides: FGA_API_URL, FGA_API_TOKEN_ISSUER, FGA_API_AUDIENCE


PATTERN 3 — CIBA PUSH APPROVAL (deleteInvoice, resetPassword)
──────────────────────────────────────────────────────────────
Tools: deleteInvoice · resetPassword

CIBA (Client-Initiated Backchannel Authentication, RFC 9126) lets the server
push an approval request to the user's enrolled device (Auth0 Guardian) before
completing a sensitive action. The user must tap "Approve" on their phone.

The flow runs entirely server-side within the MCP tool callback:

  Step 1 — Initiate:
    POST /bc-authorize
      client_id, client_secret, login_hint (sub), scope, binding_message
    → returns { auth_req_id, interval, expires_in }

    binding_message is shown on the device push notification so the user knows
    what they are approving, e.g.:
      "Approve password reset for Alice Chen (mbr-001)"

  Step 2 — Poll (inline, within same Vercel function invocation):
    deadline = Date.now() + 50_000   (50 s — Vercel maxDuration is 55 s)
    loop:
      POST /oauth/token
        grant_type = urn:openid:params:grant-type:ciba
        auth_req_id = <from step 1>
      handle responses:
        authorization_pending → wait interval seconds, retry
        slow_down             → increment interval, retry
        access_denied         → throw "Request was denied on your device."
        expired_token         → throw "Approval request expired."
        200 OK                → approval received, proceed with action

  If the deadline is reached before approval, the tool surfaces an
  "authorization pending" message. The portal UI detects this string and
  shows a banner: "Approve the push notification on your device, then click Retry."
  The Retry button re-sends the original user message, triggering a fresh CIBA flow.

Env vars required: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE
Device requirement: User must be enrolled in Auth0 Guardian push notifications


PATTERN 4 — RFC 8693 ON-BEHALF-OF TOKEN EXCHANGE (payInvoice, deactivateMember)
──────────────────────────────────────────────────────────────────────────────────
Tools: payInvoice · deactivateMember

RFC 8693 Token Exchange lets this server swap the caller's portal-scoped token
for a narrower, downstream-scoped token before calling an external service.
The downstream service never sees the caller's original token.

  payInvoice:       exchanges for audience=payments.widget.com, scope=makePayments
  deactivateMember: exchanges for audience=admin.widget.com,    scope=deactivateMembers

Implementation:

  POST /oauth/token
    grant_type        = urn:ietf:params:oauth:grant-type:token-exchange
    client_id         = AUTH0_TOKEN_EXCHANGE_CLIENT_ID   (or ADMIN variant)
    client_secret     = AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET
    subject_token     = ctx.token  (the caller's incoming JWT)
    subject_token_type = <custom type registered in Auth0>
    audience          = payments.widget.com  |  admin.widget.com
    scope             = makePayments          |  deactivateMembers

  → returns { access_token } scoped to the downstream audience

The returned token is logged (claims decoded for debugging) and then used to
authorize the downstream action (mock payment / member deactivation).

The Auth0 client used for the exchange must be configured in the Auth0 dashboard
with token exchange grant enabled and the correct audience/scope mapping.

Env vars required (invoices):  AUTH0_TOKEN_EXCHANGE_CLIENT_ID, AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET
Env vars required (members):   AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_ID, AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_SECRET


PATTERN 5 — AUTH0 TOKEN VAULT / GOOGLE OAUTH OBO (notifyViaGmail)
────────────────────────────────────────────────────────────────────
Tool: notifyViaGmail

Token Vault is an Auth0 service that stores third-party OAuth tokens (e.g. Google
refresh tokens) linked to a user identity. The tool exchanges the caller's Auth0
token for a fresh Google OAuth access token scoped to Gmail, then sends an email.

This is conceptually similar to RFC 8693 but uses Auth0's managed token storage
rather than a direct grant on the Auth0 tenant.

  1. Exchange caller's token via Token Vault → Google access_token
  2. POST to Gmail API: https://gmail.googleapis.com/gmail/v1/users/me/messages/send
  3. Return send confirmation with message ID

Env vars required: AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE,
                   NOTIFICATION_EMAIL_TO


================================================================================
  SETUP QUICK REFERENCE
================================================================================

  Copy .env.example → .env.local and fill in all values before running locally.
  For Vercel: set all vars in the project's Environment Variables dashboard.

  Required env vars:
    AUTH0_DOMAIN
    AUTH0_AUDIENCE
    AUTH0_CLIENT_ID
    AUTH0_CLIENT_SECRET
    AUTH0_TOKEN_EXCHANGE_CLIENT_ID
    AUTH0_TOKEN_EXCHANGE_CLIENT_SECRET
    AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_ID
    AUTH0_ADMIN_TOKEN_EXCHANGE_CLIENT_SECRET
    FGA_STORE_ID
    FGA_CLIENT_ID
    FGA_CLIENT_SECRET
    NOTIFICATION_EMAIL_TO
    NEXT_PUBLIC_APP_URL

================================================================================
