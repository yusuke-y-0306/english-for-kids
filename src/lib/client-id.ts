/**
 * クライアントで作る冪等キー (UUID v4) — issue #76
 *
 * クイズの `roundId`、カード閲覧の `eventId` に使う。サーバ側は形だけを見て
 * 「同じ ID の再送は数えない」を守る。
 *
 * `crypto.randomUUID()` は **secure context (HTTPS / localhost)** でしか使えない。
 * 家庭内の `http://192.168.x.x` でも遊べるよう、使えない環境では
 * `getRandomValues` から組み立て、それも無ければ `Math.random` に落とす。
 */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  /* RFC 4122 version 4 の印を立てる (サーバの UUID_PATTERN を通すため) */
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
