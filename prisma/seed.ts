import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 シードデータの投入を開始します...');

  // 1. 既存のデータを一旦リセット（何度でもテストできるようにするため）
  await prisma.checklist.deleteMany();
  await prisma.task.deleteMany();
  await prisma.communityMember.deleteMany();
  await prisma.community.deleteMany();
  await prisma.user.deleteMany();

  // 2. テスト用ユーザーの作成（全員パスワードは 'password123'）
  const hashedPassword = await bcrypt.hash('password123', 10);

  const user1 = await prisma.user.create({
    data: { email: 'front@example.com', displayName: 'フロント太郎', hashedPassword }
  });
  const user2 = await prisma.user.create({
    data: { email: 'back@example.com', displayName: 'バックエンド次郎', hashedPassword }
  });
  const user3 = await prisma.user.create({
    data: { email: 'design@example.com', displayName: 'デザイナー花子', hashedPassword }
  });

  // 3. テスト用プロジェクト（コミュニティ）の作成
  const community = await prisma.community.create({
    data: {
      name: 'SysHack_Sefirot 開発プロジェクト',
      inviteCode: 'HACK26', // フロントエンドがテスト参加しやすいように固定
      createdBy: user1.id,
      members: {
        create: [
          { userId: user1.id },
          { userId: user2.id },
          { userId: user3.id }
        ]
      }
    }
  });

  // 4. 親タスクの作成
  const parentTask1 = await prisma.task.create({
    data: {
      title: 'フロントエンド画面実装',
      description: 'React/Next.jsを使って全画面のモックアップを作成する',
      communityId: community.id,
      createdBy: user1.id,
      priority: '大',
      status: '進行中',
      progress: 50, // 子タスクの平均（100と0の平均）
      assignees: { connect: [{ id: user1.id }, { id: user3.id }] } // 複数人アサイン
    }
  });

  // 5. 子タスクの作成（親タスクに紐付け）
  await prisma.task.create({
    data: {
      title: 'ログイン画面のUI作成',
      description: 'メールアドレスとパスワードの入力フォーム。バリデーションも入れる。',
      communityId: community.id,
      parentId: parentTask1.id, // 👈 親タスクに紐付け！
      createdBy: user3.id,
      priority: '中',
      status: '完了',
      progress: 100, // 完了
      assignees: { connect: [{ id: user3.id }] },
      checklists: {
        create: [
          { content: '入力フォームの配置', isCompleted: true },
          { content: 'エラーメッセージの表示', isCompleted: true }
        ]
      }
    }
  });

  await prisma.task.create({
    data: {
      title: 'タスク一覧のツリー表示UI',
      description: 'Sefirotのメイン機能。親子関係がわかるようにインデントを下げる。',
      communityId: community.id,
      parentId: parentTask1.id, // 👈 親タスクに紐付け！
      createdBy: user1.id,
      priority: '大',
      status: '未着手',
      progress: 0, // 未着手
      assignees: { connect: [{ id: user1.id }] }
    }
  });

  // 6. 独立したタスクの作成
  await prisma.task.create({
    data: {
      title: 'バックエンドAPIの完全実装',
      description: 'YAML仕様書と1ミリのズレもなく完璧に動作するAPIを構築する。',
      communityId: community.id,
      createdBy: user2.id,
      priority: '大',
      status: '完了',
      progress: 100,
      assignees: { connect: [{ id: user2.id }] }
    }
  });

  console.log('✨ シードデータの投入が完了しました！');
  console.log('--------------------------------------------------');
  console.log('【テスト用ログイン情報】');
  console.log('メール: front@example.com / パスワード: password123');
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
