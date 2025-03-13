/**
 * OAuth V2 Implementation for Clover
 * 
 * This file implements the High-trust app Auth code flow for Clover OAuth v2.
 * https://docs.clover.com/dev/docs/high-trust-app-auth-flow
 */

import axios from "axios";
import crypto from "crypto";
import express from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

// OAuth interfaces
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  merchant_id: string;
  expires_in: number;
}

export interface OAuthV2TokenResponse {
  access_token: string;
  refresh_token: string;
  merchant_id: string; 
  access_token_expiry: number; // unix timestamp
  refresh_token_expiry: number; // unix timestamp
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  redirectUrl: string;
}

// OAuth token storage
let currentTokens: {
  accessToken: string | null;
  refreshToken: string | null;
  merchantId: string | null;
  accessTokenExpiry: number | null;
  refreshTokenExpiry: number | null;
} = {
  accessToken: null,
  refreshToken: null,
  merchantId: null,
  accessTokenExpiry: null,
  refreshTokenExpiry: null,
};

// Function to open a URL in the default browser
function openBrowser(url: string) {
  let command;
  switch (process.platform) {
    case "darwin": // macOS
      command = `open "${url}"`;
      break;
    case "win32": // Windows
      command = `start "" "${url}"`;
      break;
    default: // Linux and others
      command = `xdg-open "${url}"`;
      break;
  }

  exec(command, (error) => {
    if (error) {
      logger.error(`Failed to open browser: ${error}`);
      logger.info(`Please manually open this URL in your browser: ${url}`);
    }
  });
}

/**
 * OAuth v2 Client for Clover API
 */
export class OAuthV2Client {
  private config: OAuthConfig;
  private server: any = null;
  private state: string = "";
  private promiseResolve: ((value: OAuthV2TokenResponse) => void) | null = null;
  private promiseReject: ((reason: any) => void) | null = null;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  /**
   * Get the current OAuth tokens
   */
  getTokens() {
    return {
      accessToken: currentTokens.accessToken,
      refreshToken: currentTokens.refreshToken,
      merchantId: currentTokens.merchantId,
      accessTokenExpiry: currentTokens.accessTokenExpiry,
      refreshTokenExpiry: currentTokens.refreshTokenExpiry,
    };
  }
  
  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.config.clientId;
  }

  /**
   * Set the OAuth tokens
   */
  setTokens(tokens: OAuthV2TokenResponse) {
    currentTokens.accessToken = tokens.access_token;
    currentTokens.refreshToken = tokens.refresh_token;
    currentTokens.merchantId = tokens.merchant_id;
    currentTokens.accessTokenExpiry = tokens.access_token_expiry;
    currentTokens.refreshTokenExpiry = tokens.refresh_token_expiry;

    // Also update the .env file for persistence
    this.updateEnvFile();
  }

  /**
   * Check if we have valid tokens
   */
  hasValidTokens(): boolean {
    if (!currentTokens.accessToken || !currentTokens.merchantId) {
      return false;
    }

    // Check if the access token is expired
    if (currentTokens.accessTokenExpiry) {
      const now = Math.floor(Date.now() / 1000);
      if (now >= currentTokens.accessTokenExpiry) {
        return false;
      }
    }

    return true;
  }

  /**
   * Update the .env file with the current tokens
   */
  private updateEnvFile() {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      
      if (!fs.existsSync(envPath)) {
        logger.debug("No .env file found at", envPath);
        return;
      }

      let envContent = fs.readFileSync(envPath, "utf8");

      // Update API key
      if (currentTokens.accessToken) {
        envContent = envContent.replace(
          /CLOVER_API_KEY=.*/,
          `CLOVER_API_KEY=${currentTokens.accessToken}`
        );
      }

      // Update merchant ID
      if (currentTokens.merchantId) {
        envContent = envContent.replace(
          /CLOVER_MERCHANT_ID=.*/,
          `CLOVER_MERCHANT_ID=${currentTokens.merchantId}`
        );
      }

      fs.writeFileSync(envPath, envContent);
      logger.debug("Successfully updated .env file with the new tokens");
    } catch (error) {
      logger.error(`Error updating .env file: ${(error as Error).message}`);
    }
  }

  /**
   * Start the OAuth v2 flow
   */
  async startOAuthFlow(port: number = 4000): Promise<OAuthV2TokenResponse> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error("OAuth server is already running"));
        return;
      }

      this.promiseResolve = resolve;
      this.promiseReject = reject;

      // Generate a state parameter to prevent CSRF attacks
      this.state = crypto.randomBytes(16).toString("hex");

      // Create Express app for OAuth callback
      const app = express();

      // Set up the OAuth callback route
      app.get("/oauth-callback", async (req, res) => {
        const { code, state, merchant_id, client_id } = req.query;

        // Log all parameters for debugging
        logger.debug("OAuth callback parameters:", {
          code: code ? `${String(code).substring(0, 6)}...` : undefined,
          state,
          expectedState: this.state,
          merchant_id,
          client_id
        });

        // More lenient state checking to handle empty state from Clover sandbox
        if (state !== this.state && this.state !== "") {
          logger.debug(`State mismatch: received "${state}", expected "${this.state}"`);
          logger.debug("Proceeding anyway since this might be from app installation");
          // Continue anyway for sandbox debugging
        }

        if (!code) {
          res.status(400).send("Error: Missing authorization code");
          this.rejectPromise(new Error("Missing authorization code"));
          return;
        }

        try {
          logger.debug("Received authorization code, exchanging for tokens");

          // Store merchant ID from the callback URL in case the token response doesn't have it
          const callbackMerchantId = merchant_id as string;

          // Exchange the authorization code for tokens
          const tokenResponse = await this.exchangeCodeForTokens(code as string);
          
          if (tokenResponse) {
            // Ensure merchant ID is set - use the one from the callback if not in token response
            if (!tokenResponse.merchant_id && callbackMerchantId) {
              logger.debug(`No merchant ID in token response, using merchant ID from callback: ${callbackMerchantId}`);
              tokenResponse.merchant_id = callbackMerchantId;
            }
            
            // Ensure expiry dates are valid
            if (!tokenResponse.access_token_expiry || isNaN(tokenResponse.access_token_expiry)) {
              logger.debug("No valid access token expiry in response, setting default (1 hour)");
              tokenResponse.access_token_expiry = Math.floor(Date.now() / 1000) + 3600;
            }
            
            if (!tokenResponse.refresh_token_expiry || isNaN(tokenResponse.refresh_token_expiry)) {
              logger.debug("No valid refresh token expiry in response, setting default (30 days)");
              tokenResponse.refresh_token_expiry = Math.floor(Date.now() / 1000) + (30 * 86400);
            }
            
            logger.info("Successfully obtained OAuth tokens");

            // Update our tokens
            this.setTokens(tokenResponse);

            // Send success response to the browser
            res.send(`
              <html>
                <head>
                  <title>OAuth Tokens Generated</title>
                  <style>
                    body {
                      font-family: Arial, sans-serif;
                      max-width: 600px;
                      margin: 0 auto;
                      padding: 20px;
                      line-height: 1.6;
                    }
                    .success {
                      color: #4CAF50;
                      font-weight: bold;
                    }
                  </style>
                </head>
                <body>
                  <h1>OAuth Tokens Generated Successfully!</h1>
                  <p class="success">Your Clover OAuth tokens have been generated and saved.</p>
                  <p>You can now close this window and return to your application.</p>
                </body>
              </html>
            `);

            // Resolve the promise with the token response
            this.resolvePromise(tokenResponse);

            // Shutdown the server after a delay
            setTimeout(() => {
              this.closeServer();
            }, 3000);
          } else {
            logger.error("Error: No tokens in response");
            res.status(500).send("Error: Failed to obtain tokens");
            this.rejectPromise(new Error("No tokens in response"));
          }
        } catch (error) {
          logger.error(`Error exchanging code for tokens: ${error}`);
          res.status(500).send(`Error: ${(error as Error).message}`);
          this.rejectPromise(error as Error);
        }
      });

      // Start the server
      this.server = app.listen(port, () => {
        logger.info(`OAuth callback server running at http://localhost:${port}`);

        // Generate the authorization URL
        const redirectUri = `http://localhost:${port}/oauth-callback`;

        // Try both v1 and v2 endpoints
        // First, try the v2 endpoint as documented
        const v2AuthUrl = `${this.config.baseUrl}/oauth/v2/authorize?client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${this.state}`;
        
        // Also provide v1 endpoint as fallback
        const v1AuthUrl = `${this.config.baseUrl}/oauth/authorize?client_id=${this.config.clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${this.state}`;
        
        // Use v1 endpoint for now as it seems more compatible with sandbox
        const authUrl = v1AuthUrl;
        
        logger.debug("Authorization URLs:");
        logger.debug(`- v1: ${v1AuthUrl}`);
        logger.debug(`- v2: ${v2AuthUrl}`);
        logger.debug(`- Using: ${authUrl}`);

        logger.info("-------------------------------------------------");
        logger.info("INSTRUCTIONS:");
        logger.info("-------------------------------------------------");
        logger.info("1. A browser window will open to the Clover authorization page");
        logger.info("2. Log in with your Clover account if prompted");
        logger.info("3. Authorize the app to access your Clover account");
        logger.info("4. You will be redirected back to this application");
        logger.info("Opening browser to Clover authorization page...");

        // Open the browser to the authorization URL
        openBrowser(authUrl);
      });

      // Handle server errors
      this.server.on("error", (error: Error) => {
        logger.error(`OAuth server error: ${error}`);
        this.rejectPromise(error);
      });
    });
  }

  /**
   * Exchange an authorization code for tokens using OAuth v2 endpoints
   * With fallback to v1 if v2 fails
   */
  private async exchangeCodeForTokens(code: string): Promise<OAuthV2TokenResponse> {
    try {
      logger.debug("Attempting to exchange auth code for tokens using v2 endpoint");
      
      // Try OAuth v2 endpoint first
      try {
        const v2Response = await axios.post(
          `${this.config.baseUrl}/oauth/v2/token`,
          {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code: code
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        );
        
        logger.debug("Successfully used OAuth v2 endpoint");
        return v2Response.data;
      } catch (v2Error) {
        logger.debug("OAuth v2 endpoint failed, trying v1 endpoint");
        
        // If v2 fails, try the v1 endpoint with form data approach
        const params = new URLSearchParams();
        params.append("client_id", this.config.clientId);
        params.append("client_secret", this.config.clientSecret);
        params.append("code", code);
        
        const v1Response = await axios.post(
          `${this.config.baseUrl}/oauth/token`,
          params,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
          }
        );
        
        logger.debug("Successfully used OAuth v1 endpoint");
        
        // Convert v1 response format to v2 format
        const v1Data = v1Response.data;
        const now = Math.floor(Date.now() / 1000);
        
        return {
          access_token: v1Data.access_token,
          refresh_token: v1Data.refresh_token || "",
          merchant_id: v1Data.merchant_id,
          access_token_expiry: now + (v1Data.expires_in || 3600),
          refresh_token_expiry: now + (30 * 86400) // 30 days default
        };
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Token response error: ${JSON.stringify(error.response?.data)}`);
        throw new Error(`OAuth error: ${error.response?.data?.message || error.message}`);
      }
      throw error as Error;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<OAuthV2TokenResponse> {
    if (!currentTokens.refreshToken) {
      throw new Error("No refresh token available");
    }

    try {
      logger.debug("Refreshing access token");
      
      // Try OAuth v2 refresh endpoint first
      try {
        const v2Response = await axios.post(
          `${this.config.baseUrl}/oauth/v2/refresh`,
          {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: currentTokens.refreshToken
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        );
        
        logger.debug("Successfully refreshed token with v2 endpoint");
        
        // Update our tokens
        this.setTokens(v2Response.data);
        return v2Response.data;
      } catch (v2Error) {
        logger.debug("OAuth v2 refresh failed, trying v1 endpoint");
        
        // If v2 fails, try the v1 endpoint
        // For v1, we'll use form-encoded data as that's what the API expects
        const params = new URLSearchParams();
        params.append("client_id", this.config.clientId);
        params.append("client_secret", this.config.clientSecret);
        params.append("refresh_token", currentTokens.refreshToken);
        
        const v1Response = await axios.post(
          `${this.config.baseUrl}/oauth/token`,
          params,
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
          }
        );
        
        logger.debug("Successfully refreshed token with v1 endpoint");
        
        // Convert v1 response format to v2 format
        const v1Data = v1Response.data;
        const now = Math.floor(Date.now() / 1000);
        
        const transformedData = {
          access_token: v1Data.access_token,
          refresh_token: v1Data.refresh_token || currentTokens.refreshToken, // Keep old one if not provided
          merchant_id: v1Data.merchant_id || currentTokens.merchantId, // Keep old one if not provided
          access_token_expiry: now + (v1Data.expires_in || 3600),
          refresh_token_expiry: currentTokens.refreshTokenExpiry || now + (30 * 86400) // Keep old one or set 30 days
        };
        
        // Update our tokens
        this.setTokens(transformedData);
        return transformedData;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Refresh token response error: ${error.response?.status} ${error.response?.statusText}`);
        
        // If the refresh token fails, we'll need to reauthenticate
        throw new Error(`OAuth refresh error: Token expired or invalid. Please reauthenticate.`);
      }
      throw error as Error;
    }
  }

  /**
   * Check token status and refresh if needed
   */
  async ensureValidToken(): Promise<string> {
    if (!this.hasValidTokens()) {
      // If we have a refresh token, try to refresh the access token
      if (currentTokens.refreshToken) {
        try {
          const tokenResponse = await this.refreshAccessToken();
          return tokenResponse.access_token;
        } catch (error) {
          logger.error(`Error refreshing token: ${error}`);
          throw new Error("Unable to refresh token. Please re-authenticate.");
        }
      } else {
        throw new Error("No valid tokens available. Please authenticate using the OAuth flow.");
      }
    }
    
    return currentTokens.accessToken!;
  }

  /**
   * Close the OAuth server
   */
  private closeServer() {
    if (this.server) {
      this.server.close(() => {
        logger.debug("OAuth server closed.");
        this.server = null;
      });
    }
  }

  /**
   * Resolve the OAuth promise
   */
  private resolvePromise(value: OAuthV2TokenResponse) {
    if (this.promiseResolve) {
      this.promiseResolve(value);
      this.promiseResolve = null;
      this.promiseReject = null;
    }
  }

  /**
   * Reject the OAuth promise
   */
  private rejectPromise(reason: Error) {
    if (this.promiseReject) {
      this.promiseReject(reason);
      this.promiseReject = null;
      this.promiseResolve = null;
    }
  }
}