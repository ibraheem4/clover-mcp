/**
 * Simple logger utility to avoid polluting stdout for MCP
 */

// Control debug output - set to true to enable verbose logging to stderr
const DEBUG = false;

export const logger = {
  /**
   * Log debug messages - these only go to stderr if DEBUG is true
   */
  debug: (message: string, ...args: any[]) => {
    if (DEBUG) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },

  /**
   * Log info messages - these go to stderr for operator visibility
   */
  info: (message: string, ...args: any[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },

  /**
   * Log error messages - these always go to stderr
   */
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};