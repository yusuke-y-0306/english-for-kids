import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { findAvatar } from "./avatars";
import { masterKey, usersFile } from "./config";
import {
  decryptSecret,
  encryptSecret,
  randomId,
  safeEqual,
  type EncryptedSecret,
} from "./crypto";

/**
 * ユーザープール — DB を使わず、テキストファイル (JSON) で管理する。
 *
 * - 保存先: data/users.json (リポジトリには含めない / .gitignore 済み)
 * - 各ユーザーの「秘密」(保護者パスフレーズ) は AES-256-GCM で暗号化して保存
 * - 書き込みは tmp ファイル + rename のアトミック更新。プロセス内は直列化する
 */

export type StoredCredential = {
  /** WebAuthn credential ID (base64url) */
  id: string;
  /** COSE 公開鍵 (base64url) */
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceLabel?: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type PoolUser = {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  /** 保護者パスフレーズ (暗号化)。ファイル上は平文で持たない */
  secret?: EncryptedSecret;
  credentials: StoredCredential[];
  createdAt: string;
  updatedAt: string;
};

export type UserPool = {
  version: 1;
  updatedAt: string;
  users: PoolUser[];
};

const EMPTY_POOL: UserPool = { version: 1, updatedAt: "", users: [] };

function emptyPool(): UserPool {
  return { ...EMPTY_POOL, users: [] };
}

export async function readPool(): Promise<UserPool> {
  try {
    const raw = await readFile(usersFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserPool>;
    if (!parsed || !Array.isArray(parsed.users)) return emptyPool();
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      users: parsed.users.filter(
        (u): u is PoolUser =>
          !!u && typeof u.id === "string" && typeof u.displayName === "string",
      ),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyPool();
    throw error;
  }
}

async function writePool(pool: UserPool): Promise<void> {
  const file = usersFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const next: UserPool = { ...pool, version: 1, updatedAt: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  await chmod(file, 0o600);
}

/** プロセス内の書き込みを直列化する (同時リクエストでの取りこぼし防止) */
let writeQueue: Promise<unknown> = Promise.resolve();

export function withPool<T>(mutator: (pool: UserPool) => Promise<T> | T): Promise<T> {
  const run = writeQueue.then(async () => {
    const pool = await readPool();
    const result = await mutator(pool);
    await writePool(pool);
    return result;
  });
  // 失敗しても後続を止めない
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function findUser(userId: string): Promise<PoolUser | undefined> {
  const pool = await readPool();
  return pool.users.find((u) => u.id === userId);
}

export type PickerUser = {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  credentialCount: number;
};

/** ログイン画面用の一覧 (秘密や公開鍵は返さない) */
export async function listUsersForPicker(): Promise<PickerUser[]> {
  const pool = await readPool();
  return pool.users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    avatar: u.avatar,
    color: u.color,
    credentialCount: u.credentials.length,
  }));
}

export type CreateUserInput = {
  /** 省略時は自動生成 (setup フローでは options 時点で決めた ID を渡す) */
  id?: string;
  displayName: string;
  avatar?: string;
  color?: string;
  guardianPassphrase?: string;
  /** 事前に暗号化済みの秘密 (cookie 経由で持ち回るため平文を保持しない) */
  preparedSecret?: EncryptedSecret;
};

/** ユーザーを新規作成する (秘密は暗号化して保存) */
export async function createUser(input: CreateUserInput): Promise<PoolUser> {
  const displayName = input.displayName.trim();
  if (displayName === "") throw new Error("なまえを入力してください");
  if (displayName.length > 24) throw new Error("なまえは24文字までにしてください");
  const passphrase = input.guardianPassphrase?.trim();
  if (!input.preparedSecret && (!passphrase || passphrase.length < 8)) {
    throw new Error("保護者パスフレーズは8文字以上にしてください");
  }

  return withPool((pool) => {
    if (pool.users.some((u) => u.displayName === displayName)) {
      throw new Error(`「${displayName}」は既にいます。ちがう なまえにしてください`);
    }
    if (input.id && pool.users.some((u) => u.id === input.id)) {
      throw new Error("同じ ID のユーザーが既に存在します");
    }
    const avatar = findAvatar(input.avatar);
    const now = new Date().toISOString();
    const user: PoolUser = {
      id: input.id ?? randomId("u"),
      displayName,
      avatar: avatar.emoji,
      color: input.color ?? avatar.color,
      secret:
        input.preparedSecret ??
        encryptSecret(JSON.stringify({ guardianPassphrase: passphrase }), masterKey()),
      credentials: [],
      createdAt: now,
      updatedAt: now,
    };
    pool.users.push(user);
    return user;
  });
}

/** 保護者パスフレーズを照合する */
export function verifyGuardianPassphrase(user: PoolUser, passphrase: string): boolean {
  if (!user.secret) return false;
  try {
    const decrypted = JSON.parse(decryptSecret(user.secret, masterKey())) as {
      guardianPassphrase?: string;
    };
    if (typeof decrypted.guardianPassphrase !== "string") return false;
    return safeEqual(passphrase, decrypted.guardianPassphrase);
  } catch {
    return false;
  }
}

export async function addCredential(
  userId: string,
  credential: StoredCredential,
): Promise<void> {
  await withPool((pool) => {
    const user = pool.users.find((u) => u.id === userId);
    if (!user) throw new Error("ユーザーが見つかりません");
    if (user.credentials.some((c) => c.id === credential.id)) {
      throw new Error("この端末は既に登録されています");
    }
    user.credentials.push(credential);
    user.updatedAt = new Date().toISOString();
  });
}

export async function touchCredential(
  userId: string,
  credentialId: string,
  counter: number,
): Promise<void> {
  await withPool((pool) => {
    const user = pool.users.find((u) => u.id === userId);
    const credential = user?.credentials.find((c) => c.id === credentialId);
    if (!user || !credential) return;
    credential.counter = counter;
    credential.lastUsedAt = new Date().toISOString();
    user.updatedAt = credential.lastUsedAt;
  });
}

/** 保護者パスフレーズを変更する */
export async function setGuardianPassphrase(
  userId: string,
  nextPassphrase: string,
): Promise<void> {
  if (nextPassphrase.trim().length < 8) {
    throw new Error("保護者パスフレーズは8文字以上にしてください");
  }
  await withPool((pool) => {
    const user = pool.users.find((u) => u.id === userId);
    if (!user) throw new Error("ユーザーが見つかりません");
    user.secret = encryptSecret(
      JSON.stringify({ guardianPassphrase: nextPassphrase.trim() }),
      masterKey(),
    );
    user.updatedAt = new Date().toISOString();
  });
}

/** 端末 (credential) の登録を削除する */
export async function removeCredential(userId: string, credentialId: string): Promise<void> {
  await withPool((pool) => {
    const user = pool.users.find((u) => u.id === userId);
    if (!user) return;
    user.credentials = user.credentials.filter((c) => c.id !== credentialId);
    user.updatedAt = new Date().toISOString();
  });
}
