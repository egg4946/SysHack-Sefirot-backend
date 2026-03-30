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

// ✨ ハッカソン特化仕様：環境変数に頼らず、許可するURLを直接すべて書く！
const getCorsOrigins = (): string[] => {
  return [
    'http://localhost:5173',  // ローカル環境1
    'http://localhost:5174',  // ローカル環境2 (ポートがズレた時用)
    'https://sys-hack-sefirot-frontend.vercel.app' // Vercelの本番環境
  ];
};

export const env = {
  port: parsePort(process.env.PORT),
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigins: getCorsOrigins(), // ✨ ここを変更
};
