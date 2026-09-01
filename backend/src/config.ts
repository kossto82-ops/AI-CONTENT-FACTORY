import 'dotenv/config';

const str = (k: string, def?: string): string => process.env[k] ?? def ?? '';
const num = (k: string, def: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : def;
};

export type Tier = 'cheap' | 'standard' | 'quality';

export const config = {
  omniRoute: {
    url: str('OMNIROUTE_URL', 'http://127.0.0.1:20128'),
    apiKey: str('OMNIROUTE_API_KEY', 'sk-omniroute-local'),
  },
  dbPath: str('FACTORY_DB', './data/factory.db'),
  defaultTier: (str('FACTORY_DEFAULT_TIER', 'cheap') as Tier) ?? 'cheap',
  maxRetries: num('FACTORY_MAX_RETRIES', 2),
  shortDurationSeconds: num('SHORT_DURATION_SECONDS', 30),
  server: {
    port: num('FACTORY_PORT', 8787),
    host: str('FACTORY_HOST', '127.0.0.1'),
  },
};

export function resolveDbPath(): string {
  return config.dbPath;
}
