import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('/data'),
  AUTH_USERNAME: z.string().min(1),
  AUTH_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  DEFAULT_TZ: z.string().default('Asia/Tokyo'),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  STATIC_ROOT: z.string().optional(),
});

export interface Config {
  port: number;
  dataDir: string;
  authUsername: string;
  authPassword: string;
  jwtSecret: string;
  defaultTz: string;
  logLevel: string;
  trustProxy: boolean;
  /** Directory holding the built SPA, or null for an API-only deployment. */
  staticRoot: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    dataDir: parsed.DATA_DIR,
    authUsername: parsed.AUTH_USERNAME,
    authPassword: parsed.AUTH_PASSWORD,
    jwtSecret: parsed.JWT_SECRET,
    defaultTz: parsed.DEFAULT_TZ,
    logLevel: parsed.LOG_LEVEL,
    trustProxy: parsed.TRUST_PROXY === 'true',
    staticRoot: parsed.STATIC_ROOT ?? null,
  };
}
