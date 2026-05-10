import type { HttpClient } from '../../ports/http.js';

export class FetchHttpClient implements HttpClient {
  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText} ${body}`);
    }
    return response.json() as Promise<T>;
  }
}