import dotenv from 'dotenv';

dotenv.config();

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parsePort = (rawPort: string | undefined): number => {
  const parsed = Number(rawPort ?? 8000);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('PORT must be a positive integer');
  }
  return parsed;
};

const parseCorsOrigins = (rawOrigins: string | undefined): string[] => {
  if (!rawOrigins) {
    return ['http://localhost:5173'];
  }

  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

export const env = {
  port: parsePort(process.env.PORT),
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
};
