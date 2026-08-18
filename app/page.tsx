export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '40px auto', padding: '0 20px' }}>
      <h1>Invoice MCP Server</h1>
      <p>
        MCP endpoint:{' '}
        <code style={{ background: '#f4f4f4', padding: '2px 6px', borderRadius: 4 }}>/api/mcp</code>
      </p>
      <p style={{ color: '#555' }}>
        Not sure what this agent can do? Type <code>/help</code> in your AI client for a full list of available tools.
      </p>

      <h2>Connect an MCP Client</h2>
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
{`{
  "mcpServers": {
    "invoices": {
      "url": "https://<your-app>.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <access_token>"
      }
    }
  }
}`}
      </pre>
    </main>
  )
}
