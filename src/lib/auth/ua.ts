import { createHash } from "node:crypto";

/**
 * セッション cookie と「端末」の紐付け — issue #53
 *
 * `efk_session` は「誰か」しか証明していない。cookie がコピーされれば別の端末からでも
 * 同じセッションとして通ってしまう。ここでは `User-Agent` から端末の指紋を作り、
 * セッションに署名して持ち回ることで「別の端末に渡った cookie」を検知する。
 *
 * ## なぜ「完全一致」を既定にしないか
 *
 * `User-Agent` はブラウザ / OS の更新で普通に変わる（Safari の "Version/17.1" 等）。
 * 子どもは自分でログインし直せない（パスキー or 親の合言葉が要る）ので、
 * 完全一致で縛ると **更新のたびに詰む**。だから 2 段構えにする。
 *
 *  - `cls` (iphone / ipad / android / mac / windows / linux / other) が変わった
 *    → 端末が変わったとみなして **セッション無効**（別端末へのコピーはここで落ちる）
 *  - 同じ `cls` でハッシュだけ変わった
 *    → ブラウザ更新とみなして **通す + 新しい指紋で cookie を再発行**（自己修復）
 *
 * `SESSION_UA_STRICT=1` にすると完全一致を要求する。厳しくしたい人のための逃げ道で、
 * 既定にはしない（issue #53 のリスク節を参照）。
 *
 * 注意: `User-Agent` は攻撃者が自由に名乗れる。これは「盗まれた cookie の使い回しに
 * 気づく」ための仕組みであって、暗号学的な端末証明ではない。
 */

export type UaClass = "iphone" | "ipad" | "android" | "mac" | "windows" | "linux" | "other";

/**
 * 判定はこの順で行う。順番が意味を持つ:
 *  - iPhone / iPad の UA は "like Mac OS X" を含むので mac より先に見る
 *  - Android の UA は "Linux" を含むので linux より先に見る
 */
const CLASS_PATTERNS: ReadonlyArray<readonly [UaClass, RegExp]> = [
  ["ipad", /ipad/],
  ["iphone", /iphone|ipod/],
  ["android", /android/],
  ["windows", /windows/],
  ["mac", /macintosh|mac os x/],
  ["linux", /linux|x11/],
];

/** UA から「端末の種類」を取り出す。判別できなければ other */
export function uaClassOf(ua: string | null | undefined): UaClass {
  const value = (ua ?? "").toLowerCase();
  if (value === "") return "other";
  // Chromebook は "X11; CrOS ... Linux" で Linux と紛れるので先に other へ
  if (value.includes("cros")) return "other";
  for (const [cls, pattern] of CLASS_PATTERNS) {
    if (pattern.test(value)) return cls;
  }
  return "other";
}

/** UA の指紋 (SHA-256 の先頭 16 文字)。生の UA は cookie に載せない */
export function uaHashOf(ua: string | null | undefined): string {
  return createHash("sha256").update(ua ?? "", "utf8").digest("hex").slice(0, 16);
}

/** cookie に載せる端末の同一性 (SessionPayload の `ua` / `uc` と同じ形) */
export type DeviceBinding = {
  /** UA 全体のハッシュ */
  readonly ua: string;
  /** UA の種類 (粗い) */
  readonly uc: UaClass;
};

export function bindingOf(ua: string | null | undefined): DeviceBinding {
  return { ua: uaHashOf(ua), uc: uaClassOf(ua) };
}

/**
 * 判定結果
 *  - ok       : 同じ端末
 *  - legacy   : `ua` を持たない古い cookie（移行措置。通して再発行する）
 *  - drift    : 同じ種類だがハッシュが違う（ブラウザ更新。通して再発行する）
 *  - mismatch : 端末が変わった（別端末へのコピー。セッション無効）
 */
export type BindingVerdict = "ok" | "legacy" | "drift" | "mismatch";

/** cookie に保存されている側 (= DeviceBinding と同じ形) */
export type StoredBinding = {
  readonly ua?: string;
  readonly uc?: string;
};

export function compareBinding(
  stored: StoredBinding | undefined | null,
  current: DeviceBinding,
  strict: boolean,
): BindingVerdict {
  if (!stored?.ua) return "legacy";
  if (stored.ua === current.ua) return "ok";
  // 種類が分かるように保存してある場合、種類が違えば問答無用で別端末
  if (stored.uc && stored.uc !== current.uc) return "mismatch";
  return strict ? "mismatch" : "drift";
}
