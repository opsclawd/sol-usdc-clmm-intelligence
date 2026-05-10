export interface JsonStore {
  readJson<T>(path: string): Promise<T | undefined>;
  writeJson(path: string, value: unknown): Promise<void>;
}