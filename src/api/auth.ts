export class AuthManager {
  private token: string | null = null;
  private expiresAt: Date | null = null;

  private get apiKey(): string {
    return process.env.PARTNER_API_KEY || '';
  }

  private get tokenUrl(): string {
    return process.env.PARTNER_TOKEN_URL || 'https://platform.bankkaro.com/partner/token';
  }

  async getToken(): Promise<string> {
    if (this.token && this.expiresAt && this.expiresAt > new Date()) {
      return this.token;
    }

    if (!this.apiKey) {
      throw new Error('PARTNER_API_KEY is not set');
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'x-api-key': this.apiKey.trim() }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Token fetch failed (${response.status}): ${err}`);
    }

    const data = await response.json();

    if (data.status === 'success' && data.data?.jwttoken) {
      this.token = data.data.jwttoken;
      this.expiresAt = new Date(data.data.expiresAt);
      return this.token as string;
    }

    throw new Error('Invalid token response format');
  }

  async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'partner-token': token,
        'Content-Type': 'application/json',
      },
    });
  }
}

export const authManager = new AuthManager();
