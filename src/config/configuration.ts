import { z } from 'zod';

const configSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DB_WRITER_URL: z.string().url(),
  DB_READER_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string(),
  REDIS_TTL_DEFAULT: z.coerce.number().default(300),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // API-Football (RapidAPI)
  FOOTBALL_DATA_API_KEY: z.string(),

  // Firebase Cloud Messaging
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // Throttle
  THROTTLE_TTL: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(100),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:4200'),
});

export type AppConfig = z.infer<typeof configSchema>;

export default (): AppConfig => {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
};
