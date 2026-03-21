import { PrismaClient } from '@prisma/client';

// アプリ全体でこの1つのPrismaインスタンスを使い回す（メモリ不足エラー防止）
const prisma = new PrismaClient();

export default prisma;
