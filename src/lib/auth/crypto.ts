import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * 認証用の暗号ユーティリティ。
 *
 * - ユーザープールのテキストファイルに保存する「秘密」は AES-256-GCM で暗号化する
 * - セッション cookie / チャレンジ cookie は HMAC-SHA256 で署名する (改ざん検知)
 */

export type EncryptedSecret = {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ct: string;
};

export function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/**
 * base64url 文字列を Uint8Array に戻す。
 * SimpleWebAuthn の型は Uint8Array<ArrayBuffer> を要求するため、
 * Buffer (ArrayBufferLike) をそのまま渡すと型が合わない。
 */
export function fromBase64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}

/** ランダムな ID を作る (例: u_xxxxxxxxxxxx) */
export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

/** ランダムな文字列 (hex) */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 定数時間比較 (長さが違っても落ちないように) */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // 長さの差でもタイミングが漏れないようダミー比較を行う
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** AES-256-GCM で暗号化する (鍵は 32 バイト) */
export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "aes-256-gcm",
    iv: toBase64Url(iv),
    tag: toBase64Url(tag),
    ct: toBase64Url(ct),
  };
}

/** AES-256-GCM で復号する。改ざん・鍵違いは例外になる */
export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  if (secret.alg !== "aes-256-gcm") {
    throw new Error(`未対応の暗号方式です: ${secret.alg}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(secret.iv));
  decipher.setAuthTag(fromBase64Url(secret.tag));
  return Buffer.concat([
    decipher.update(fromBase64Url(secret.ct)),
    decipher.final(),
  ]).toString("utf8");
}

/** `payload.signature` 形式の署名付きトークンを作る */
export function signToken(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** 署名を検証して payload を取り出す。改ざんされていれば null */
export function verifyToken<T>(token: string | undefined | null, secret: string): T | null {
  if (!token) return null;
  const index = token.lastIndexOf(".");
  if (index <= 0) return null;
  const body = token.slice(0, index);
  const sig = token.slice(index + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
