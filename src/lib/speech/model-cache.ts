import {
  MODEL_FILES,
  MODEL_PATH_PREFIX,
  MODEL_SET_HASH,
  MODEL_TOTAL_BYTES,
  type ModelFileName,
} from "./model-manifest";
import { MODEL_ORIGIN, modelUrl } from "./model-origin";

/**
 * モデルの取得キャッシュ — issue #29
 *
 * 方針:
 *  - 取得先はアプリとは別オリジン (#30)。**キャッシュは信頼しない**。
 *    書き込む前に sha256 を照合し、読み出す前にもう一度照合する。
 *  - 全ファイルが揃うまで「準備完了」にしない。本キャッシュに直接書き、**最後に sentinel**
 *    を書いて確定する。sentinel が無ければ未完成とみなす。失敗時はキャッシュごと捨てる。
 *    (staging キャッシュに落として昇格する方式は、ピーク時にモデルの 2 倍の容量が要るため
 *     採用しない。実測でも 2 倍の書き込みで QuotaExceededError になった)
 *  - キャッシュ名に manifest の指紋を含める。モデルが変われば別のキャッシュになり、
 *    古いものは削除する。
 *  - ダウンロードは Web Locks でタブ間排他。取れない環境でも、sentinel 方式なので
 *    同時に走っても「全ファイル + sentinel」が揃った状態にしかならない（冪等）。
 */

/** 本キャッシュ。指紋の先頭 12 文字を名前に含める */
export const MODEL_CACHE_NAME = `moonshine-models-${MODEL_SET_HASH.slice(0, 12)}`;
const LOCK_NAME = "efk:model-download";
/** 全ファイルが揃ったことを示す sentinel のキャッシュキー (実在しない URL でよい) */
const READY_KEY = `${MODEL_ORIGIN}/${MODEL_PATH_PREFIX}/__ready`;

export const MODEL_FILE_NAMES = Object.keys(MODEL_FILES) as ModelFileName[];
export const MODEL_SIZE_BYTES = MODEL_TOTAL_BYTES;

export type ModelFileKey = ModelFileName;

export type ModelErrorKind =
  /** Cache Storage が使えない (非セキュアコンテキスト等) */
  | "unsupported"
  /** 容量不足 */
  | "quota"
  /** オフライン / 取得失敗 */
  | "offline"
  /** HTTP エラー */
  | "fetch"
  /** sha256 不一致 (改ざん or 破損) */
  | "verify"
  /** 呼び出し側が中断した */
  | "aborted";

export class ModelCacheError extends Error {
  readonly kind: ModelErrorKind;
  readonly file?: ModelFileKey;

  constructor(kind: ModelErrorKind, message: string, file?: ModelFileKey, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelCacheError";
    this.kind = kind;
    this.file = file;
  }
}

export type DownloadProgress = {
  /** 累計バイト数 */
  loaded: number;
  /** 総バイト数 */
  total: number;
  /** いま取得中のファイル */
  file: ModelFileKey | null;
};

export type EnsureOptions = {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
};

function cacheStorage(): CacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cache Storage に積むときの本文。配列の view のままだと BodyInit として扱えない */
function toBody(bytes: Uint8Array): ArrayBuffer {
  return (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer
  ) as ArrayBuffer;
}

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // 32bit ビューで渡すと余計なコピーが起きるので、元の ArrayBuffer をそのまま渡す
  const buffer =
    view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
      ? view.buffer
      : view.slice().buffer;
  return toHex(await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer));
}

function toModelCacheError(error: unknown, file?: ModelFileKey): ModelCacheError {
  if (error instanceof ModelCacheError) return error;
  const name = (error as { name?: string } | null)?.name;
  const message = (error as { message?: string } | null)?.message ?? String(error);
  if (name === "QuotaExceededError") {
    return new ModelCacheError("quota", "保存できる容量が足りません", file, { cause: error });
  }
  if (name === "AbortError") {
    return new ModelCacheError("aborted", "中断しました", file, { cause: error });
  }
  // fetch の失敗 (オフライン / DNS / CORS) は TypeError で来る
  if (error instanceof TypeError) {
    return new ModelCacheError("offline", "ダウンロードできませんでした", file, { cause: error });
  }
  return new ModelCacheError("fetch", message, file, { cause: error });
}

/* ------------------------------------------------------------------ */
/* 状態判定                                                            */
/* ------------------------------------------------------------------ */

/** 全てのファイルと sentinel が揃っているか (中身の検証はしない) */
export async function isModelReady(): Promise<boolean> {
  const storage = cacheStorage();
  if (!storage) return false;
  try {
    const cache = await storage.open(MODEL_CACHE_NAME);
    if (!(await cache.match(READY_KEY))) return false;
    for (const name of MODEL_FILE_NAMES) {
      if (!(await cache.match(modelUrl(name)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 保存済みの古い/半端なキャッシュをすべて消す */
export async function clearModelCache(): Promise<void> {
  const storage = cacheStorage();
  if (!storage) return;
  for (const name of await storage.keys()) {
    if (name.startsWith("moonshine-models-")) await storage.delete(name);
  }
}

/** 空き容量が足りるか (足りないと確信できるときだけ false) */
export async function hasStorageRoom(): Promise<boolean> {
  const storage = cacheStorage();
  const estimate = globalThis.navigator?.storage?.estimate;
  if (!storage || !estimate) return true;
  try {
    const { quota, usage } = await estimate.call(globalThis.navigator.storage);
    if (typeof quota !== "number") return true;
    return quota - (usage ?? 0) > MODEL_TOTAL_BYTES * 1.2;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 取得                                                                */
/* ------------------------------------------------------------------ */

async function readWithProgress(
  response: Response,
  file: ModelFileKey,
  onProgress?: (progress: DownloadProgress) => void,
  base = 0,
): Promise<Uint8Array> {
  const total = MODEL_TOTAL_BYTES;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: base + bytes.byteLength, total, file });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded: base + loaded, total, file });
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * モデルを取得してキャッシュに確定させる。既に準備済みなら何もしない。
 * 失敗時は staging を破棄するので、中途半端な状態は残らない。
 */
export async function ensureModels(options: EnsureOptions = {}): Promise<void> {
  const storage = cacheStorage();
  if (!storage) {
    throw new ModelCacheError("unsupported", "この環境ではモデルを保存できません");
  }
  if (await isModelReady()) {
    options.onProgress?.({ loaded: MODEL_TOTAL_BYTES, total: MODEL_TOTAL_BYTES, file: null });
    return;
  }
  if (!(await hasStorageRoom())) {
    throw new ModelCacheError("quota", "空き容量が足りません");
  }

  const run = () => downloadToCache(storage, options);
  const locks = globalThis.navigator?.locks;
  // タブ間で同時に走らせない。取れない環境でも壊れないので、失敗時はそのまま実行する。
  if (locks?.request) {
    await locks.request(LOCK_NAME, run);
  } else {
    await run();
  }
}

async function downloadToCache(storage: CacheStorage, options: EnsureOptions): Promise<void> {
  const { onProgress, signal } = options;
  if (await isModelReady()) return;

  // 永続化を要求しておく (Safari は無操作 7 日でストレージを消すことがある)
  await globalThis.navigator?.storage?.persist?.().catch(() => false);

  const target = await storage.open(MODEL_CACHE_NAME);
  // 先に sentinel を外して「未完成」にする。以降どこで失敗しても ready にはならない。
  await target.delete(READY_KEY).catch(() => false);
  let loaded = 0;

  try {
    for (const name of MODEL_FILE_NAMES) {
      signal?.throwIfAborted();
      const url = modelUrl(name);
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) {
        throw new ModelCacheError("fetch", `${response.status} ${response.statusText}`, name);
      }
      const bytes = await readWithProgress(response, name, onProgress, loaded);
      loaded += bytes.byteLength;

      const expected = MODEL_FILES[name];
      if (bytes.byteLength !== expected.bytes) {
        throw new ModelCacheError(
          "verify",
          `サイズが違います (期待 ${expected.bytes} / 実際 ${bytes.byteLength})`,
          name,
        );
      }
      if ((await sha256Hex(bytes)) !== expected.sha256) {
        throw new ModelCacheError("verify", "sha256 が一致しません", name);
      }
      await target.put(
        url,
        new Response(toBody(bytes), {
          headers: {
            "content-type": name.endsWith(".json") ? "application/json" : "application/octet-stream",
            "content-length": String(bytes.byteLength),
          },
        }),
      );
    }

    // sentinel は最後。これがあるときだけ「準備完了」とみなす。
    await target.put(READY_KEY, new Response(MODEL_SET_HASH));
    onProgress?.({ loaded: MODEL_TOTAL_BYTES, total: MODEL_TOTAL_BYTES, file: null });
  } catch (error) {
    // 中途半端に書いた分は残さない (次回はゼロから取り直す)
    await storage.delete(MODEL_CACHE_NAME).catch(() => false);
    throw toModelCacheError(error);
  }

  // 古い版のキャッシュを片付ける
  for (const name of await storage.keys()) {
    if (name.startsWith("moonshine-models-") && name !== MODEL_CACHE_NAME) {
      await storage.delete(name).catch(() => false);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 読み出し (検証つき)                                                 */
/* ------------------------------------------------------------------ */

/**
 * キャッシュから全ファイルを読み出して sha256 を照合する。
 * 不一致があればキャッシュを捨てて `verify` エラーを投げるので、
 * 呼び出し側は `ensureModels()` からやり直せばよい。
 */
export async function loadVerifiedFiles(): Promise<Map<ModelFileKey, Uint8Array>> {
  const storage = cacheStorage();
  if (!storage) {
    throw new ModelCacheError("unsupported", "この環境ではモデルを保存できません");
  }
  const cache = await storage.open(MODEL_CACHE_NAME);
  if (!(await cache.match(READY_KEY))) {
    throw new ModelCacheError("fetch", "モデルがまだ準備できていません");
  }

  const files = new Map<ModelFileKey, Uint8Array>();
  const broken: ModelFileKey[] = [];
  for (const name of MODEL_FILE_NAMES) {
    const hit = await cache.match(modelUrl(name));
    if (!hit) {
      broken.push(name);
      continue;
    }
    const bytes = new Uint8Array(await hit.arrayBuffer());
    const expected = MODEL_FILES[name];
    if (bytes.byteLength !== expected.bytes || (await sha256Hex(bytes)) !== expected.sha256) {
      broken.push(name);
      continue;
    }
    files.set(name, bytes);
  }

  if (broken.length > 0) {
    // 壊れたキャッシュは残さない。次の ensureModels() で取り直す。
    await clearModelCache();
    throw new ModelCacheError("verify", `検証に失敗しました: ${broken.join(", ")}`, broken[0]);
  }
  return files;
}
