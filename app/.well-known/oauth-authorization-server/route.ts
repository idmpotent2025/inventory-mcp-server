/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * This MCP server is a resource server; Auth0 is the authorization server.
 * This route proxies Auth0's own AS metadata document so MCP clients can
 * discover token_endpoint, jwks_uri, etc. from this domain without a
 * cross-origin fetch to Auth0.
 *
 * Discovery chain for MCP clients:
 *   1. GET /.well-known/oauth-protected-resource  → { authorization_servers: ["https://...auth0.com"] }
 *   2. GET /.well-known/oauth-authorization-server → proxied from Auth0
 *   3. POST {token_endpoint}  (client_credentials) → access_token
 *   4. POST /api/mcp  + Bearer token               → tools
 */

import { NextResponse } from 'next/server'

export async function GET() {
  const auth0Domain = process.env.AUTH0_DOMAIN

  if (!auth0Domain) {
    return NextResponse.json(
      { error: 'AUTH0_DOMAIN environment variable is not configured' },
      { status: 500 },
    )
  }

  const upstreamUrl = `https://${auth0Domain}/.well-known/oauth-authorization-server`

  const upstream = await fetch(upstreamUrl, {
    headers: { Accept: 'application/json' },
  })

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Failed to fetch AS metadata from Auth0: ${upstream.status}` },
      { status: 502 },
    )
  }

  const metadata = await upstream.json()

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
