#!/usr/bin/env node

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import axios from "axios";

// Load .env file from the project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { CloverApiClient } from "./clover-client.js";
import { logger } from "./logger.js";

// Get OAuth credentials from environment variables
const CLIENT_ID = process.env.CLOVER_CLIENT_ID;
const CLIENT_SECRET = process.env.CLOVER_CLIENT_SECRET;
const BASE_URL = process.env.CLOVER_BASE_URL || "https://apisandbox.dev.clover.com";
const REDIRECT_URI = "http://localhost:4000/oauth-callback";

// Check if we have OAuth credentials
if (!CLIENT_ID || !CLIENT_SECRET) {
  logger.error(
    "Error: CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET environment variables are required"
  );
  logger.error("");
  logger.error("To use this tool, you need to set up OAuth credentials:");
  logger.error("1. Create a Clover developer account at developer.clover.com");
  logger.error("2. Register your app in the Clover Developer Dashboard");
  logger.error("3. Set the OAuth credentials in your .env file:");
  logger.error("   CLOVER_CLIENT_ID=your-client-id");
  logger.error("   CLOVER_CLIENT_SECRET=your-client-secret");
  process.exit(1);
}

// Initialize the Clover API client
const cloverClient = new CloverApiClient(
  CLIENT_ID,
  CLIENT_SECRET,
  BASE_URL,
  REDIRECT_URI
);

// Create the MCP server
const server = new Server(
  {
    name: "clover-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      resources: {
        clover_item: true,
        clover_order: true,
      },
      tools: {
        list_inventory: true,
        list_orders: true,
        get_merchant_info: true,
        initiate_oauth_flow: true,
        get_oauth_status: true,
      },
    },
  }
);

// Set up resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "clover://items/{itemId}",
      name: "Item details",
      mimeType: "application/json",
      description:
        "Get detailed information about a specific Clover inventory item",
    },
    {
      uriTemplate: "clover://orders/{orderId}",
      name: "Order details",
      mimeType: "application/json",
      description: "Get detailed information about a specific Clover order",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
  const itemMatch = request.params.uri.match(/^clover:\/\/items\/([^/]+)$/);
  const orderMatch = request.params.uri.match(/^clover:\/\/orders\/([^/]+)$/);

  if (itemMatch) {
    const itemId = itemMatch[1];
    try {
      const item = await cloverClient.getItem(itemId);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(item, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch item: ${error}`
      );
    }
  }

  if (orderMatch) {
    const orderId = orderMatch[1];
    try {
      const order = await cloverClient.getOrder(orderId);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(order, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch order: ${error}`
      );
    }
  }

  throw new McpError(
    ErrorCode.InvalidRequest,
    `Invalid URI format: ${request.params.uri}`
  );
});

// Set up tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_inventory",
      description: "List inventory items with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Filter query for inventory items",
          },
          offset: {
            type: "number",
            description: "Offset for pagination",
          },
          limit: {
            type: "number",
            description: "Maximum number of items to return",
            default: 100,
          },
        },
      },
    },
    {
      name: "list_orders",
      description: "List orders with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "Filter query for orders",
          },
          start: {
            type: "string",
            description: "Start date for filtering orders (ISO format)",
          },
          end: {
            type: "string",
            description: "End date for filtering orders (ISO format)",
          },
          limit: {
            type: "number",
            description: "Maximum number of orders to return",
            default: 100,
          },
        },
      },
    },
    {
      name: "get_merchant_info",
      description: "Get information about the merchant",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "initiate_oauth_flow",
      description: "Initiate the OAuth flow to get tokens",
      inputSchema: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Port to run the OAuth server on (default: 4000)",
          },
        },
      },
    },
    {
      name: "get_oauth_status",
      description: "Check if OAuth credentials are available",
      inputSchema: {
        type: "object",
        properties: {},
      },
    }
  ],
}));

// Define argument types
type ListInventoryArgs = {
  query?: string;
  offset?: number;
  limit?: number;
};

type ListOrdersArgs = {
  filter?: string;
  start?: string;
  end?: string;
  limit?: number;
};

type InitiateOAuthFlowArgs = {
  port?: number;
};

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "list_inventory": {
        const args = request.params.arguments as unknown as ListInventoryArgs;
        const result = await cloverClient.listInventory(
          args.query,
          args.offset,
          args.limit
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_orders": {
        const args = request.params.arguments as unknown as ListOrdersArgs;
        const result = await cloverClient.listOrders(
          args.filter,
          args.start,
          args.end,
          args.limit
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_merchant_info": {
        const merchant = await cloverClient.getMerchantInfo();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(merchant, null, 2),
            },
          ],
        };
      }

      case "initiate_oauth_flow": {
        const args = request.params.arguments as unknown as InitiateOAuthFlowArgs;
        const port = args?.port || 4000;

        try {
          logger.info(`Starting OAuth flow on port ${port}...`);
          const tokenResponse = await cloverClient.initiateOAuthFlow(port);

          return {
            content: [
              {
                type: "text",
                text: `OAuth flow completed successfully!\n\nAccess Token: ${tokenResponse.access_token.substring(
                  0,
                  5
                )}...${tokenResponse.access_token.substring(
                  tokenResponse.access_token.length - 5
                )}\nMerchant ID: ${tokenResponse.merchant_id}\nAccess Token Expiry: ${new Date(
                  tokenResponse.access_token_expiry * 1000
                ).toLocaleString()}\n\nTokens are stored in memory and will be used for all API calls. You can now use get_merchant_info to test.`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `OAuth flow failed: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "get_oauth_status": {
        const hasCredentials = cloverClient.hasValidCredentials();
        const tokens = cloverClient.getOAuthClient().getTokens();

        let statusText = hasCredentials
          ? "OAuth credentials are available and valid."
          : "OAuth credentials are not available. Use the initiate_oauth_flow tool to obtain them.";

        // Add token info if available
        if (tokens.accessToken) {
          const now = Math.floor(Date.now() / 1000);
          const accessExpiry = tokens.accessTokenExpiry;
          const refreshExpiry = tokens.refreshTokenExpiry;
          
          statusText += `\n\nAccess Token: ${tokens.accessToken.substring(0, 5)}...${tokens.accessToken.substring(tokens.accessToken.length - 5)}`;
          statusText += `\nMerchant ID: ${tokens.merchantId}`;
          
          if (accessExpiry) {
            const expiresIn = accessExpiry - now;
            statusText += `\nAccess Token expires in: ${Math.floor(expiresIn / 60)} minutes`;
          }
          
          if (refreshExpiry) {
            const expiresIn = refreshExpiry - now;
            statusText += `\nRefresh Token expires in: ${Math.floor(expiresIn / 86400)} days`;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: statusText,
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  } catch (error: any) {
    logger.error(`Clover API Error: ${error}`);
    return {
      content: [
        {
          type: "text",
          text: `Clover API error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.debug("Clover MCP server running on stdio");
}

main().catch((error) => {
  logger.error(`Server error: ${error}`);
  process.exit(1);
});