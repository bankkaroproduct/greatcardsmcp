/**
 * Per-client API key authentication layer.
 *
 * Clients connect to the MCP server with their own API key.
 * Each key maps to a client record with:
 *   - name: client display name
 *   - partnerApiKey: the BankKaro partner key to use for this client
 *   - rateLimit: max requests per minute (optional)
 *   - enabled: kill switch
 *
 * Keys are loaded from CLIENT_KEYS env var (JSON) or a clients.json file.
 *
 * Example CLIENT_KEYS env var:
 * {
 *   "gc_live_abc123": { "name": "Acme Bot", "partnerApiKey": "34b88b71...", "rateLimit": 30, "enabled": true },
 *   "gc_live_def456": { "name": "FinBot Inc", "partnerApiKey": "34b88b71...", "rateLimit": 60, "enabled": true }
 * }
 *
 * All clients can share the same partnerApiKey (if you use one BankKaro account)
 * or each can have their own (for per-client attribution/billing).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface ClientRecord {
  name: string;
  partnerApiKey: string;
  rateLimit?: number;        // max requests per minute (default: 60)
  enabled: boolean;
}

interface RateLimitEntry {
  timestamps: number[];
}

class ClientAuthManager {
  private clients: Map<string, ClientRecord> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  constructor() {
    this.loadClients();
  }

  private loadClients() {
    // Try CLIENT_KEYS env var first (JSON string)
    const envKeys = process.env.CLIENT_KEYS;
    if (envKeys) {
      try {
        const parsed = JSON.parse(envKeys);
        for (const [key, record] of Object.entries(parsed)) {
          this.clients.set(key, record as ClientRecord);
        }
        console.error(`[client-auth] Loaded ${this.clients.size} client keys from env`);
        return;
      } catch (err) {
        console.error('[client-auth] Failed to parse CLIENT_KEYS env var:', err);
      }
    }

    // Fallback: try clients.json file
    try {
      const filePath = resolve(process.cwd(), 'clients.json');
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      for (const [key, record] of Object.entries(parsed)) {
        this.clients.set(key, record as ClientRecord);
      }
      console.error(`[client-auth] Loaded ${this.clients.size} client keys from clients.json`);
    } catch {
      // No client keys configured — auth disabled, use default PARTNER_API_KEY
      console.error('[client-auth] No client keys configured — auth layer disabled, using default PARTNER_API_KEY');
    }
  }

  get isEnabled(): boolean {
    return this.clients.size > 0;
  }

  /**
   * Validate a client API key.
   * Returns the client record if valid, null if invalid.
   */
  authenticate(apiKey: string | null | undefined): ClientRecord | null {
    if (!this.isEnabled) {
      // Auth not configured — allow all, use default partner key
      return {
        name: 'default',
        partnerApiKey: process.env.PARTNER_API_KEY || '',
        rateLimit: 60,
        enabled: true,
      };
    }

    if (!apiKey) return null;

    const client = this.clients.get(apiKey);
    if (!client) return null;
    if (!client.enabled) return null;

    return client;
  }

  /**
   * Check rate limit for a client key.
   * Returns true if allowed, false if rate limited.
   */
  checkRateLimit(apiKey: string, maxPerMinute?: number): boolean {
    const limit = maxPerMinute || 60;
    const now = Date.now();
    const windowMs = 60_000;

    let entry = this.rateLimits.get(apiKey);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(apiKey, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    if (entry.timestamps.length >= limit) {
      return false; // Rate limited
    }

    entry.timestamps.push(now);
    return true;
  }

  /**
   * List all registered clients (for admin/debug).
   */
  listClients(): Array<{ key_prefix: string; name: string; enabled: boolean; rateLimit: number }> {
    return Array.from(this.clients.entries()).map(([key, record]) => ({
      key_prefix: key.slice(0, 8) + '...',
      name: record.name,
      enabled: record.enabled,
      rateLimit: record.rateLimit || 60,
    }));
  }
}

export const clientAuth = new ClientAuthManager();
