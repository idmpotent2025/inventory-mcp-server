/**
 * Permanent redirect: /api/mcp → /api/mcp/bookkeeper
 *
 * Uses 308 (Permanent Redirect) to preserve the HTTP method (POST/GET/DELETE)
 * so existing MCP clients that pointed at /api/mcp continue to work.
 */

function redirect(req: Request): Response {
  const url = new URL(req.url)
  url.pathname = url.pathname.replace(/^\/api\/mcp(\/.*)?$/, '/api/mcp/bookkeeper')
  return Response.redirect(url.toString(), 308)
}

export { redirect as GET, redirect as POST, redirect as DELETE }
