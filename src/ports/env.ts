export interface EnvReader {
  get(name: string, fallback?: string): string;
  getOptional(name: string): string | undefined;
}