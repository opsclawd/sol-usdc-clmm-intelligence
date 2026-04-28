import 'dotenv/config';

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value == null || value.length === 0 ? undefined : value;
}

export function isRecommendationOnly(): boolean {
  return (process.env.RECOMMENDATION_ONLY ?? 'true').toLowerCase() !== 'false';
}
