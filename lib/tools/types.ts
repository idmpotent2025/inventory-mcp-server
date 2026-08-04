/**
 * Shared MCP tool execution context — carries identity and call metadata
 * extracted from the Auth0 bearer token on the incoming MCP request.
 */
export type MCPToolContext = {
  /** JWT `sub` claim — the authenticated user's ID */
  sub: string
  /** Raw bearer access token — used as OBO subject token for TokenVault and token exchange */
  token: string
  /** Unique identifier for this tool invocation */
  toolCallId: string
}
