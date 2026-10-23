import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { contentDir } from "./config";

/**
 * ユーザーごとのコンテンツ (学習の状態など) を JSON ファイルで持つ。
 * DB は使わない方針なので、1 ユーザー = 1 ファイル。
 *
 * issue #4 (進捗管理) はこのストアの上に載せる想定。
 */

export type UserContent = {
  userId: string;
  visits: number;
  lastSeenAt?: string;
  /** 自由記述の学習状態 (機能ごとに使う) */
  data: Record<string, unknown>;
};

function fileFor(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, "");
  return path.join(contentDir(), `${safe}.json`);
}

function emptyContent(userId: string): UserContent {
  return { userId, visits: 0, data: {} };
}

export async function getUserContent(userId: string): Promise<UserContent> {
  try {
    const raw = await readFile(fileFor(userId), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserContent>;
    return {
      userId,
      visits: typeof parsed.visits === "number" ? parsed.visits : 0,
      lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : undefined,
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyContent(userId);
    throw error;
  }
}

async function saveContent(content: UserContent): Promise<void> {
  const file = fileFor(content.userId);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
}

/** ログイン時に来訪を記録する */
export async function recordVisit(userId: string): Promise<UserContent> {
  const content = await getUserContent(userId);
  const next: UserContent = {
    ...content,
    visits: content.visits + 1,
    lastSeenAt: new Date().toISOString(),
  };
  await saveContent(next);
  return next;
}

/** 学習状態を部分更新する */
export async function updateUserContent(
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserContent> {
  const content = await getUserContent(userId);
  const next: UserContent = { ...content, data: { ...content.data, ...patch } };
  await saveContent(next);
  return next;
}
