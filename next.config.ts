import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required: disable edge runtime so AsyncLocalStorage (used by @auth0/ai-vercel) works
  // MCP route runs in Node.js serverless runtime by default
}

export default nextConfig
