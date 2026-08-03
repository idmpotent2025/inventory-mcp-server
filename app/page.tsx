export default function HomePage() {
  const tools = [
    {
      name: 'listInventory',
      auth: 'Bearer token (Auth0 JWT)',
      description: 'List all inventory items. Requires a valid access token with read:inventory scope.',
    },
    {
      name: 'addItem',
      auth: 'Bearer token + FGA + CIBA + Token Vault (OBO)',
      description:
        'Add a new item. Requires: (1) FGA writer relation on inventory:default, ' +
        '(2) CIBA out-of-band push approval on the user\'s device, ' +
        '(3) Token Vault OBO exchange for a Slack token, then posts a Slack notification.',
    },
  ]

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '40px auto', padding: '0 20px' }}>
      <h1>Inventory MCP Server</h1>
      <p>
        MCP endpoint: <code style={{ background: '#f4f4f4', padding: '2px 6px', borderRadius: 4 }}>/api/mcp</code>
      </p>

      <h2>Auth0 for MCP Capabilities</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f4f4f4' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #ddd' }}>Tool</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #ddd' }}>Authorization</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', border: '1px solid #ddd' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t.name}>
              <td style={{ padding: '8px 12px', border: '1px solid #ddd' }}>
                <code>{t.name}</code>
              </td>
              <td style={{ padding: '8px 12px', border: '1px solid #ddd', color: '#555' }}>{t.auth}</td>
              <td style={{ padding: '8px 12px', border: '1px solid #ddd', color: '#555' }}>{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Connect an MCP Client</h2>
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 20, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
{`{
  "mcpServers": {
    "inventory": {
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
