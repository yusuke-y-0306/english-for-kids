import path from "node:path";

/**
 * 認証まわりの設定値。
 *
 * すべて遅延評価 (関数) にしているのは、`next build` 時に環境変数が
 * 無くてもビルドを失敗させないため。実際に認証処理が走る瞬間にだけ
 * 必須チェックが入る。
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** ユーザープール等を置くディレクトリ (既定: <repo>/data) */
export function dataDir(): string {
  const override = readEnv("AUTH_DATA_DIR");
  if (override) {
    // 環境変数で差し替え可能にしつつ、Turbopack のファイル追跡を抑止する
    return path.resolve(/*turbopackIgnore: true*/ override);
  }
  return path.join(process.cwd(), "data");
}

/** ユーザープールのテキストファイル (JSON) */
export function usersFile(): string {
  return path.join(dataDir(), "users.json");
}

/** ユーザーごとのコンテンツ (学習状態など) を置くディレクトリ */
export function contentDir(): string {
  return path.join(dataDir(), "content");
}

export const SESSION_COOKIE = "efk_session";
export const CHALLENGE_COOKIE = "efk_challenge";

/** セッション有効期間: 30 日 (子どもが毎回ログインしなくて済むように長め) */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;
/** WebAuthn チャレンジの有効期間: 5 分 */
export const CHALLENGE_MAX_AGE_SEC = 60 * 5;

/** セッション cookie の署名鍵 (32 文字以上) */
export function sessionSecret(): string {
  const secret = readEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET が未設定、または短すぎます (32 文字以上)。.env.local もしくは systemd の EnvironmentFile を確認してください。",
    );
  }
  return secret;
}

/** ユーザーの「秘密」(保護者パスフレーズ) を暗号化するマスター鍵 (base64 / 32 バイト) */
export function masterKey(): Buffer {
  const raw = readEnv("USERPOOL_MASTER_KEY");
  if (!raw) {
    throw new Error(
      "USERPOOL_MASTER_KEY が未設定です。`npm run auth:keygen` で生成し、.env.local / EnvironmentFile に設定してください。",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "USERPOOL_MASTER_KEY は base64 で 32 バイト (256bit) を指定してください。生成: `npm run auth:keygen`",
    );
  }
  return key;
}

/** 新しいユーザーを追加するときの管理者パスフレーズ (未設定なら「最初の1人」のみ作成可) */
export function adminPassphrase(): string | undefined {
  return readEnv("GUARDIAN_ADMIN_PASSPHRASE");
}

export const RP_NAME = readEnv("WEBAUTHN_RP_NAME") ?? "こども英語ひろば";

/** RP ID を環境変数で固定する場合 (本番ドメイン確定後に設定する) */
export function rpIDFromEnv(): string | undefined {
  return readEnv("WEBAUTHN_RP_ID");
}

/** オリジンを環境変数で固定する場合 (例: https://eigo.example.com) */
export function originFromEnv(): string | undefined {
  return readEnv("WEBAUTHN_ORIGIN");
}
