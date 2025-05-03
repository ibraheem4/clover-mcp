# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands
- Build project: `npm run build`
- Watch mode: `npm run watch`
- Run MCP inspector: `npx @modelcontextprotocol/inspector build/index.js`
- Run server: `./run.sh` or `CLOVER_CLIENT_ID=id CLOVER_CLIENT_SECRET=secret node build/index.js`

## Code Style Guidelines
- TypeScript with strict mode enabled
- ES modules format (type: "module" in package.json)
- Clear error handling with specific error messages
- Use logger.debug/info/error for logging (avoid console.log)
- Follow OAuth V2 implementation for Clover authentication

## Project Structure
- src/index.ts: Main entry point, MCP server implementation
- src/clover-client.ts: Clover API client for data access
- src/oauth-v2.ts: OAuth implementation for Clover authentication
- src/logger.ts: Logging utility to avoid polluting stdout

## Available MCP Tools
- get_oauth_status: Check OAuth credentials
- initiate_oauth_flow: Start OAuth flow for access tokens
- get_merchant_info: Retrieve merchant data
- list_inventory: Get inventory items
- list_orders: Get order data