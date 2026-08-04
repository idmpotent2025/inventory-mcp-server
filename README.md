# Invoice MCP Server 

A Next.js web app deployed on Vercel that acts as an MCP (Model Context Protocol) server for inventory management. Demonstrates all **Auth0 for MCP** capabilities via the [`@auth0/ai-vercel`](https://github.com/auth0/auth0-ai-js) SDK.

## Auth0 for MCP Capabilities

| Capability | Tool | What it does |
|---|---|---|
| JWT Bearer Token | all tools | `withMcpAuth` + `jose` JWKS verification validates the Auth0 access token on every request |
| FGA (Fine-Grained Authorization) | `addItem` | `withFGA` checks `user:<sub> writer inventory:default` before adding items |
| FGA + CIBA Step-up | `deleteItem` | `withFGA` checks `user:<sub> owner inventory:<id>` AND `withAsyncAuthorization` sends a CIBA push for out-of-band approval |
| Token Vault | `commentItem` | `withTokenVault` fetches a federated Slack access token stored in Auth0 Token Vault |

## MCP Endpoint

```
POST/GET/DELETE https://<your-app>.vercel.app/api/mcp
```

All requests require:
```
Authorization: Bearer <Auth0 access_token>
```

The access token must have the `read:inventory` scope (plus `write:inventory` for mutations).

## Tools

### `listInventory`
Returns all inventory items. No extra authorization beyond the bearer token.

### `addItem`
```json
{ "name": "Widget X", "quantity": 50, "price": 12.99 }
```
Requires FGA relation: `user:<sub> writer inventory:default`

### `deleteItem`
```json
{ "id": "item-001" }
```
Requires:
1. FGA relation: `user:<sub> owner inventory:item-001`
2. CIBA approval — the user receives a push notification and must approve

### `commentItem`
```json
{ "id": "item-001", "comment": "Reorder ASAP" }
```
Saves the comment and posts a Slack message via Auth0 Token Vault (user must have linked Slack account).

## Setup

### 1. Auth0 Tenant

1. Create an **API** in Auth0 with audience matching `AUTH0_AUDIENCE`, with scopes `read:inventory` and `write:inventory`.
2. Create an **M2M application** with Client Credentials grant for CIBA token exchange and Token Vault operations. Note the Client ID and Secret.
3. Enable **Auth0 Fine Grained Authorization** and create a store. Configure tuples for your test users:
   ```
   user:<sub> writer inventory:default
   user:<sub> owner inventory:item-001
   ```
4. Enable **CIBA** on your tenant (requires a push notification provider).
5. Configure a **Slack social connection** in Auth0 with `chat:write` scope and enable Token Vault storage.

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Add the same variables in your Vercel project settings (Settings → Environment Variables).

Optional variable for Slack notifications:
```
SLACK_CHANNEL_ID=C0123456789
SLACK_REFRESH_TOKEN=xoxe-...   # fallback for testing; normally read from JWT claims
```

### 3. Deploy to Vercel

```bash
npm install
vercel deploy
```

Or connect your GitHub repo to Vercel for automatic deployments.

### 4. Connect an MCP Client

```json
{
  "mcpServers": {
    "inventory": {
      "url": "https://<your-app>.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <access_token>"
      }
    }
  }
}
```

Get an access token via the Auth0 Device Flow, Authorization Code flow, or your preferred grant.

## FGA Model

Minimum required tuples for testing:

```
type user
type inventory
  relations
    define writer: [user]
    define owner: [user]
```

Create tuples:
```bash
fga tuple write --store-id $FGA_STORE_ID \
  --user user:<your-sub> \
  --relation writer \
  --object inventory:default

fga tuple write --store-id $FGA_STORE_ID \
  --user user:<your-sub> \
  --relation owner \
  --object inventory:item-001
```

## Known Limitations

- **CIBA store**: The in-memory `MemoryStore` (default in `Auth0AI`) does not persist across Vercel cold starts. For production, configure a persistent store such as `@auth0/ai-redis` backed by Vercel KV or Upstash Redis.
- **Inventory store**: In-memory; resets on cold start. Replace with Vercel Postgres, Neon, or similar for persistence.

## Local Development

```bash
npm install
cp .env.example .env.local
# fill in .env.local
npm run dev
```

MCP server will be available at `http://localhost:3000/api/mcp`.
