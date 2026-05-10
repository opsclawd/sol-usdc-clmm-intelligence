export interface HttpClient {
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
}
