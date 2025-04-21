# Clover MCP (Model Context Protocol) Server

[![smithery badge](https://smithery.ai/badge/@ibraheem4/clover-mcp)](https://smithery.ai/server/@ibraheem4/clover-mcp)

A minimal MCP server for interacting with the Clover API using OAuth authentication.

## Overview

This MCP server allows generative AI models and other clients to access your Clover merchant data using the Model Context Protocol. With this integration, models can:

- Retrieve merchant information
- List inventory items
- List orders
- Access individual items and orders

## Quick Start

### Installing via Smithery

To install Clover MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@ibraheem4/clover-mcp):

```bash
npx -y @smithery/cli install @ibraheem4/clover-mcp --client claude
```

### Using with Claude AI (Recommended)

1. Add this to your Claude MCP settings (usually in `~/.config/anthropic/claude.mcp.json`):

```json
{
  "mcpServers": {
    "clover": {
      "command": "npx",
      "args": ["-y", "@ibraheem4/clover-mcp"],
      "env": {
        "CLOVER_CLIENT_ID": "your-clover-client-id",
        "CLOVER_CLIENT_SECRET": "your-clover-client-secret",
        "CLOVER_BASE_URL": "https://apisandbox.dev.clover.com"
      },
      "disabled": false,
      "autoApprove": ["initiate_oauth_flow", "get_merchant_info", "list_inventory", "list_orders"]
    }
  }
}
```

2. Use it with Claude:

```
/mcp use clover
```

3. Start the OAuth flow in your conversation with Claude:

```
Can you help me connect to my Clover account?
```

### Using via Command Line

You can run the MCP server directly:

```bash
# Install and run in one command
npx @ibraheem4/clover-mcp

# With credentials
CLOVER_CLIENT_ID=your-client-id CLOVER_CLIENT_SECRET=your-client-secret npx @ibraheem4/clover-mcp
```

## Clover OAuth Setup

Before using this MCP server, you need to set up a Clover app:

1. Create a Clover developer account at [developer.clover.com](https://developer.clover.com)
2. Register a new app in the Clover Developer Dashboard
3. Configure your app with:
   - Site URL: `http://localhost:4000/oauth-callback`
   - Default OAuth Response: `Code`
4. Note your Client ID and Client Secret
5. Add these credentials to your environment or `.env` file

## MCP Tools

The following tools are available via the MCP protocol:

- `get_oauth_status`: Check if OAuth credentials are available
- `initiate_oauth_flow`: Start the OAuth flow to get access tokens
- `get_merchant_info`: Get information about the merchant
- `list_inventory`: List inventory items with optional filters
- `list_orders`: List orders with optional filters

## Example Usage with Claude

Here are some example prompts you can use with Claude after connecting:

1. **Connect to Clover**:
   ```
   I'd like to connect to my Clover account.
   ```

2. **Get Merchant Information**:
   ```
   What information do you have about my Clover merchant account?
   ```

3. **List Inventory Items**:
   ```
   Show me the first 10 items in my inventory.
   ```

4. **List Orders**:
   ```
   Can you list my most recent orders?
   ```

## Development

### Local Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your OAuth credentials:
   ```bash
   cp .env.example .env
   # Edit .env with your Clover OAuth credentials
   ```
4. Build the TypeScript code:
   ```bash
   npm run build
   ```
5. Start the MCP server:
   ```bash
   ./run.sh
   ```

### Publishing Updates

To publish a new version to npm:

```bash
# Update version in package.json
npm version patch  # or minor, or major

# Build and publish
npm run build
npm publish
```

## Troubleshooting

If you encounter OAuth problems:

1. Verify your Clover app is properly registered
2. Check that the Site URL in your app settings is set to `http://localhost:4000/oauth-callback`
3. Ensure your Client ID and Client Secret are correct
4. Make sure "Default OAuth Response" is set to "Code" in the developer dashboard
5. Try starting the OAuth flow again with `initiate_oauth_flow`

## License

MIT
