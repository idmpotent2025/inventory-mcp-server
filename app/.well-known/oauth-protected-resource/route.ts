/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * MCP clients discover this document via:
 *   GET /.well-known/oauth-protected-resource
 *
 * The document tells the client which authorization server issues tokens
 * for this resource, enabling the full OAuth discovery flow:
 *   1. Fetch this document → learn authorization_servers
 *   2. Fetch {AS}/.well-known/oauth-authorization-server → learn token_endpoint
 *   3. POST client_credentials to token_endpoint → get access_token
 *   4. Call /api/mcp with Bearer token
 */

import { NextResponse } from 'next/server'

export async function GET() {
  const resourceUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000'
  const auth0Domain = process.env.AUTH0_DOMAIN!

  const metadata = {
    resource: resourceUrl,
    authorization_servers: [`https://${auth0Domain}`],
    scopes_supported: ['tool:list_vehicles'],
    bearer_methods_supported: ['header'],
  }

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
