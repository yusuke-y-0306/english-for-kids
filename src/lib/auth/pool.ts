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
import { normalizePassphrase } from "./passphrase";
import { filterVisible, type PersonalDataAccess } from "./access";

/**
 * ユーザープール — DB を使わず、テキストファイル (JSON) で管理する。
 *
 * - 保存先: data/users.json (リポジトリには含めない / .gitignore 済み)
 * - 「おうち 共通の合言葉」(保護者パスフレーズ) を 1 つだけ持つ。新規追加も
 *   端末追加も同じ合言葉で通す (守るべき秘密を増やさない)。AES-256-GCM で暗号化。
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
  /**
   * 旧形式の ユーザーごとの保護者パスフレーズ (暗号化)。
   * いまは「おうち 共通の合言葉」に統一したため読み取り専用の遺物。
   * 既存インストールからの移行時に familySecret の種として使う。
   */
  secret?: EncryptedSecret;
  credentials: StoredCredential[];
  createdAt: string;
  updatedAt: string;
};

export type UserPool = {
  version: 1;
  updatedAt: string;
  /** おうち 共通の合言葉 (暗号化)。これ 1 つで 新規追加 も 端末追加 も通す */
  familySecret?: EncryptedSecret;
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
      familySecret: parsed.familySecret,
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

/**
 * credential (端末の鍵) からユーザーを引く。
 * ログイン画面で なまえを 出さずに「ゆび/かお で ログイン」できるようにするため。
 */
export async function findUserByCredential(
  credentialId: string,
): Promise<PoolUser | undefined> {
  const pool = await readPool();
  return pool.users.find((u) => u.credentials.some((c) => c.id === credentialId));
}

export type PickerUser = {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
  credentialCount: number;
};

/**
 * ログイン画面用の一覧 (秘密や公開鍵は返さない)。
 *
 * **`PersonalDataAccess` を要求する。** 認可を通していないコードは呼べない
 * (コンパイルエラー)。返す範囲も許可証の `visibleUserIds` に絞られる。
 */
export async function listUsersForPicker(
  access: PersonalDataAccess,
): Promise<PickerUser[]> {
  const pool = await readPool();
  return filterVisible(pool.users, access).map((u) => ({
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
    /* 最初の 1 人を作った時点で、その合言葉が「おうち 共通」になる。
       旧形式 (ユーザーごとの秘密しか無い) プールでも、ここで引き継がれる。 */
    if (!pool.familySecret && user.secret) pool.familySecret = user.secret;
    return user;
  });
}

/** 暗号化された秘密から パスフレーズを取り出す */
function passphraseFromSecret(secret: EncryptedSecret): string | null {
  try {
    const decrypted = JSON.parse(decryptSecret(secret, masterKey())) as {
      guardianPassphrase?: string;
    };
    return typeof decrypted.guardianPassphrase === "string"
      ? decrypted.guardianPassphrase
      : null;
  } catch {
    return null;
  }
}

function matchesSecret(secret: EncryptedSecret, normalizedInput: string): boolean {
  const stored = passphraseFromSecret(secret);
  return stored !== null && safeEqual(normalizedInput, normalizePassphrase(stored));
}

/**
 * おうち 共通の合言葉 (保護者パスフレーズ) を照合する。
 *
 * 新規追加 (2 人目以降) も、既存の こどもへの端末追加も、この 1 つだけ。
 * 旧形式のプール (familySecret 無し) では、いずれかの こどもの 秘密を
 * 合言葉とみなす — 既存インストールが そのまま動き続けるように。
 */
export async function verifyFamilyPassphrase(input: string): Promise<boolean> {
  const pool = await readPool();
  const normalized = normalizePassphrase(input);
  if (normalized === "") return false;
  if (pool.familySecret) return matchesSecret(pool.familySecret, normalized);
  return pool.users.some((u) => (u.secret ? matchesSecret(u.secret, normalized) : false));
}

/** おうち 共通の合言葉を 決め直す (初回セットアップ / 忘れたときの復旧) */
export async function setFamilyPassphrase(nextPassphrase: string): Promise<void> {
  const normalized = normalizePassphrase(nextPassphrase);
  if (normalized.length < 8) {
    throw new Error("合言葉は 8 もじ いじょうに してください");
  }
  await withPool((pool) => {
    pool.familySecret = encryptSecret(
      JSON.stringify({ guardianPassphrase: normalized }),
      masterKey(),
    );
  });
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

/** 端末 (credential) の登録を削除する */
export async function removeCredential(userId: string, credentialId: string): Promise<void> {
  await withPool((pool) => {
    const user = pool.users.find((u) => u.id === userId);
    if (!user) return;
    user.credentials = user.credentials.filter((c) => c.id !== credentialId);
    user.updatedAt = new Date().toISOString();
  });
}
