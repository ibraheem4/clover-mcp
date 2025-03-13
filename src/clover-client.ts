/**
 * Clover API Client
 * 
 * This file implements a client for interacting with the Clover API.
 */

import axios, { AxiosInstance } from "axios";
import { OAuthV2Client } from "./oauth-v2.js";
import { logger } from "./logger.js";

// Clover API interfaces
export interface CloverItem {
  id: string;
  name: string;
  price: number;
  priceType: string;
  defaultTaxRates: boolean;
  sku?: string;
  code?: string;
  unitName?: string;
  cost?: number;
  isRevenue?: boolean;
  stockCount?: number;
  modifiedTime?: number;
}

export interface CloverOrder {
  id: string;
  currency: string;
  total: number;
  state: string;
  createdTime: number;
  modifiedTime: number;
  employee?: {
    id: string;
    name: string;
  };
  lineItems?: {
    id: string;
    name: string;
    price: number;
    quantity: number;
  }[];
}

export interface CloverMerchant {
  id: string;
  name: string;
  address?: {
    address1?: string;
    address2?: string;
    address3?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  phoneNumber?: string;
  website?: string;
  currency?: string;
}

/**
 * Clover API Client
 */
export class CloverApiClient {
  private client!: AxiosInstance;
  private baseUrl: string;
  private oauthClient: OAuthV2Client;

  constructor(
    clientId: string,
    clientSecret: string,
    baseUrl: string,
    redirectUrl: string
  ) {
    this.baseUrl = baseUrl;
    
    // Initialize OAuth client
    this.oauthClient = new OAuthV2Client({
      clientId,
      clientSecret,
      baseUrl,
      redirectUrl
    });

    this.updateClient();
  }

  /**
   * Initialize or update the API client
   */
  private async updateClient() {
    // Create a base client with minimal configuration
    const baseClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    // Create a request interceptor to add auth headers
    baseClient.interceptors.request.use(async (config) => {
      try {
        // Try to get a valid token
        const token = await this.oauthClient.ensureValidToken();
        
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${this.baseUrl}${config.url || ''}`);
        
        // Add the auth header
        config.headers.Authorization = `Bearer ${token}`;
        
        return config;
      } catch (error) {
        logger.error(`Error getting valid token: ${error}`);
        return Promise.reject(error);
      }
    });

    // Handle 401 errors by triggering token refresh
    baseClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        // If the error is 401 and we haven't retried yet
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          try {
            // Try to refresh the token
            await this.oauthClient.refreshAccessToken();
            
            // Retry the request
            return baseClient(originalRequest);
          } catch (refreshError) {
            logger.error(`Error refreshing token: ${refreshError}`);
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(error);
      }
    );
    
    this.client = baseClient;
  }

  /**
   * Get the OAuth client
   */
  getOAuthClient() {
    return this.oauthClient;
  }
  
  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
  
  /**
   * Get the app ID (client ID)
   */
  async getAppId(): Promise<string | null> {
    try {
      // Try to get app ID from token payload
      const token = await this.oauthClient.ensureValidToken();
      if (token.includes(".")) {
        try {
          const [, payload] = token.split(".");
          // Make base64 URL safe by padding if needed
          const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
          const padding = base64.length % 4;
          const paddedBase64 = padding ? base64 + '='.repeat(4 - padding) : base64;
          
          const decodedPayload = JSON.parse(Buffer.from(paddedBase64, 'base64').toString());
          if (decodedPayload.app_uuid) {
            return decodedPayload.app_uuid;
          }
        } catch (e) {
          // Ignore errors, fall back to client ID
        }
      }
      
      // Fall back to client ID from config
      return this.oauthClient.getClientId();
    } catch (error) {
      logger.error(`Error getting app ID: ${error}`);
      return null;
    }
  }

  /**
   * Check if we have valid tokens
   */
  hasValidCredentials(): boolean {
    return this.oauthClient.hasValidTokens();
  }

  /**
   * Start the OAuth flow to get tokens
   */
  async initiateOAuthFlow(port: number = 4000) {
    return this.oauthClient.startOAuthFlow(port);
  }

  /**
   * Ensure we have valid credentials before making API calls
   */
  private async ensureCredentials() {
    const tokens = this.oauthClient.getTokens();
    
    // Check if we have an access token
    if (!tokens.accessToken) {
      throw new Error(
        "API key is required. Use initiate_oauth_flow to obtain it."
      );
    }
    
    // Check if we have a merchant ID
    if (!tokens.merchantId) {
      throw new Error(
        "Merchant ID is required. Use initiate_oauth_flow with a valid merchant account."
      );
    }
    
    // This will refresh the token if needed
    await this.oauthClient.ensureValidToken();
  }

  /**
   * Get merchant information
   */
  async getMerchantInfo(): Promise<CloverMerchant> {
    await this.ensureCredentials();
    try {
      // Get the access token and merchant ID
      const token = await this.oauthClient.ensureValidToken();
      const merchantId = this.oauthClient.getTokens().merchantId;
      
      logger.debug(`Getting merchant info for ID: ${merchantId}`);
      
      // Try direct API request
      const response = await axios.get(
        `${this.baseUrl}/v3/merchants/${merchantId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          }
        }
      );
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Clover API error: ${error.response?.status} ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * List inventory items
   */
  async listInventory(
    query?: string,
    offset?: number,
    limit: number = 100
  ): Promise<{ elements: CloverItem[] }> {
    await this.ensureCredentials();
    try {
      const merchantId = this.oauthClient.getTokens().merchantId;
      const response = await this.client.get(`/v3/merchants/${merchantId}/items`, {
        params: {
          filter: query,
          offset,
          limit,
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Clover API error: ${error.response?.status} ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * List orders
   */
  async listOrders(
    filter?: string,
    start?: string,
    end?: string,
    limit: number = 100
  ): Promise<{ elements: CloverOrder[] }> {
    await this.ensureCredentials();
    try {
      const merchantId = this.oauthClient.getTokens().merchantId;
      const response = await this.client.get(`/v3/merchants/${merchantId}/orders`, {
        params: {
          filter,
          start,
          end,
          limit,
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Clover API error: ${error.response?.status} ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<CloverOrder> {
    await this.ensureCredentials();
    try {
      const merchantId = this.oauthClient.getTokens().merchantId;
      const response = await this.client.get(`/v3/merchants/${merchantId}/orders/${orderId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Clover API error: ${error.response?.status} ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get item by ID
   */
  async getItem(itemId: string): Promise<CloverItem> {
    await this.ensureCredentials();
    try {
      const merchantId = this.oauthClient.getTokens().merchantId;
      const response = await this.client.get(`/v3/merchants/${merchantId}/items/${itemId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Clover API error: ${error.response?.status} ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }
}