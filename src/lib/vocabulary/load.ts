/**
 * 語彙コンテンツの読み込みと検証 — issue #83
 *
 * 語彙は `content/vocabulary/<category>.json` に置く。コード (`words.ts`) は
 * **読み込み口と互換アダプタだけ**を持ち、語そのものは持たない。
 *
 * 検証はここ 1 か所だけに書き、次の 3 経路が同じ規則を通る:
 *
 * - ビルド時 (`src/lib/vocabulary/registry.ts` → `words.ts` 経由。壊れていれば `next build` が落ちる)
 * - CI (`npm run vocabulary:check` → `scripts/vocabulary-check.mjs`)
 * - 単体テスト (`tests/unit/vocabulary.test.mjs`)
 *
 * このファイルは **実行時の import を持たない**こと。Node の type stripping で
 * 直接 import して検証するため (依存を足すとテストと CI が動かなくなる)。
 */

/** 品詞。表示用ではなくデータの分類なので英語スラッグで持つ */
export const WORD_POS = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "determiner",
  "numeral",
  "preposition",
  "conjunction",
  "interjection",
  /** サイトワード (the / and / is など)。意味より「見て読めること」を優先する語 */
  "function",
  /** アルファベット 1 文字 (フォニックス。#88)。`en` は文字そのもの ("a") */
  "letter",
] as const;

export type WordPos = (typeof WORD_POS)[number];

/** CEFR のレベル。このアプリで扱うのは幼児〜小学生ぶんなので A2 まで */
export const CEFR_LEVELS = ["pre-a1", "a1", "a2"] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** サイトワードの文脈例。音声は単語ぶんだけを必須にし、例文は文字で持つ */
export type WordExample = {
  en: string;
  ja: string;
};

export type Word = {
  /**
   * 不変の ID (`<category>/<slug>` 形式)。進捗・発音の保存キー。
   *
   * **`en` を直しても変えないこと。** 綴りを直しただけで学習履歴が切れるのは
   * 避けたいので、ID は表示語と切り離してある (`wordId()` はこれを返すだけ)。
   */
  id: string;
  en: string;
  ja: string;
  emoji: string;
  pos: WordPos;
  level: CefrLevel;
  /** 音声ファイルの public パス。未生成なら `null` (キー自体は必須) */
  audio: string | null;
  /**
   * 読み上げ用のテキスト。省略時は `en`。
   *
   * フォニックス (#88) のフォニーム音は「文字の名前」ではなく「音」を鳴らしたい
   * (`a` を "エイ" ではなく /æ/ に近い音で)。TTS に投げる文字列だけ差し替える。
   */
  tts?: string;
  /** 画像の public パス。任意 */
  image?: string | null;
  /**
   * 同じ音で綴りが違う語。認識器は音を文字に落とすので、これらが返ってきても正解にする
   * (two → "too" / eye → "I")。採点は `scorePronunciation()` の `homophones` に渡す。
   */
  homophones?: string[];
  /** 意味は同じだが別の語 (mother → "mom")。お手本の語ではないので `ok` にはせず `close` 止まり */
  variants?: string[];
  /** 文脈例 (サイトワード)。絵で描けない語を「文の中で」覚えるために使う */
  example?: WordExample;
};

export type Category = {
  id: string;
  label: string;
  emoji: string;
  /** Tailwind gradient classes for the card front */
  color: string;
  words: Word[];
};

/** 1 ファイル分の生データ。`path` はエラーメッセージに出すためだけに使う */
export type VocabularySource = {
  path: string;
  data: unknown;
};

export class VocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabularyError";
  }
}

const CATEGORY_ID = /^[a-z][a-z0-9-]*$/;
const WORD_ID = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const PUBLIC_PATH = /^\//;

const CATEGORY_KEYS = ["id", "label", "emoji", "color", "words"] as const;

const WORD_KEYS = [
  "id",
  "en",
  "ja",
  "emoji",
  "pos",
  "level",
  "audio",
  "tts",
  "image",
  "homophones",
  "variants",
  "example",
] as const;

function fail(where: string, message: string): never {
  throw new VocabularyError(`${where}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(where, `unknown field "${key}" (allowed: ${allowed.join(", ")})`);
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    fail(where, `"${key}" must be a non-empty string`);
  }
  return found;
}

/** 任意の非空文字列。無ければ `undefined` (省略可能な項目に使う) */
function optionalText(
  value: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  if (!(key in value)) return undefined;
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    fail(where, `"${key}" must be a non-empty string when present`);
  }
  return found;
}

/** `null` か、`/` で始まる public パス。未生成を null で表す項目に使う */
function nullablePublicPath(
  value: Record<string, unknown>,
  key: string,
  where: string,
): string | null | undefined {
  if (!(key in value)) return undefined;
  const found = value[key];
  if (found === null) return null;
  if (typeof found !== "string" || !PUBLIC_PATH.test(found)) {
    fail(where, `"${key}" must be null or a public path starting with "/"`);
  }
  return found;
}

function stringList(
  value: Record<string, unknown>,
  key: string,
  where: string,
): string[] | undefined {
  if (!(key in value)) return undefined;
  const found = value[key];
  if (!Array.isArray(found)) {
    fail(where, `"${key}" must be an array of strings`);
  }
  const seen = new Set<string>();
  for (const [index, item] of found.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      fail(where, `"${key}[${index}]" must be a non-empty string`);
    }
    if (seen.has(item)) {
      fail(where, `"${key}[${index}]" is a duplicate of "${item}"`);
    }
    seen.add(item);
  }
  return [...found];
}

function parseExample(
  raw: Record<string, unknown>,
  where: string,
): WordExample | undefined {
  if (!("example" in raw)) return undefined;
  const found = raw.example;
  if (!isRecord(found)) fail(where, "must be an object");
  checkKeys(found, ["en", "ja"] as const, where);
  return {
    en: requireString(found, "en", where),
    ja: requireString(found, "ja", where),
  };
}

function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(where, `must be one of ${allowed.join(" | ")} (got ${JSON.stringify(value)})`);
  }
  return value as T;
}

function parseWord(
  raw: unknown,
  index: number,
  categoryId: string,
  where: string,
  seenWordIds: Set<string>,
): Word {
  const at = `${where}.words[${index}]`;
  if (!isRecord(raw)) fail(at, "must be an object");
  checkKeys(raw, WORD_KEYS, at);

  const id = requireString(raw, "id", at);
  if (!WORD_ID.test(id)) {
    fail(at, `"id" must look like "<category>/<slug>" in lower-kebab-case (got "${id}")`);
  }
  if (!id.startsWith(`${categoryId}/`)) {
    fail(
      at,
      `"id" must start with "${categoryId}/" (the file's category) — got "${id}"`,
    );
  }
  if (seenWordIds.has(id)) {
    fail(at, `duplicate word id "${id}"`);
  }
  seenWordIds.add(id);

  return {
    id,
    en: requireString(raw, "en", at),
    ja: requireString(raw, "ja", at),
    emoji: requireString(raw, "emoji", at),
    pos: checkEnum(raw.pos, WORD_POS, `${at}.pos`),
    level: checkEnum(raw.level, CEFR_LEVELS, `${at}.level`),
    audio: nullablePublicPath(raw, "audio", at) ?? null,
    tts: optionalText(raw, "tts", at),
    image: nullablePublicPath(raw, "image", at),
    example: parseExample(raw, `${at}.example`),
    homophones: stringList(raw, "homophones", at),
    variants: stringList(raw, "variants", at),
  };
}

function parseCategory(
  source: VocabularySource,
  seenCategoryIds: Set<string>,
  seenWordIds: Set<string>,
): Category {
  const where = source.path;
  const raw = source.data;
  if (!isRecord(raw)) fail(where, "must contain a JSON object");
  checkKeys(raw, CATEGORY_KEYS, where);

  const id = requireString(raw, "id", where);
  if (!CATEGORY_ID.test(id)) {
    fail(where, `"id" must be lower-kebab-case (got "${id}")`);
  }
  if (seenCategoryIds.has(id)) {
    fail(where, `duplicate category id "${id}"`);
  }
  seenCategoryIds.add(id);

  if (!Array.isArray(raw.words)) fail(where, `"words" must be an array`);
  if (raw.words.length === 0) fail(where, `"words" must not be empty`);

  return {
    id,
    label: requireString(raw, "label", where),
    emoji: requireString(raw, "emoji", where),
    color: requireString(raw, "color", where),
    words: raw.words.map((word, index) =>
      parseWord(word, index, id, where, seenWordIds),
    ),
  };
}

/**
 * 生の JSON を検証して `categories` にする。1 つでも壊れていれば throw。
 *
 * 検証するもの: 必須項目 / 未知フィールド (typo 検出) / ID 形式と重複 /
 * カテゴリと ID の対応 (未知カテゴリ) / 品詞・レベルの列挙 / public パス。
 */
export function buildCategories(
  sources: readonly VocabularySource[],
): Category[] {
  if (sources.length === 0) {
    throw new VocabularyError("no vocabulary files found");
  }
  const seenCategoryIds = new Set<string>();
  const seenWordIds = new Set<string>();
  return sources.map((source) =>
    parseCategory(source, seenCategoryIds, seenWordIds),
  );
}

/**
 * 単語の安定した ID (進捗・発音の保存キー)。
 *
 * 値は JSON の `id` をそのまま返すだけ。**`en` から組み立てない**ので、
 * 表示語の綴りを直しても学習履歴は切れない。
 */
export function wordId(word: Word): string {
  return word.id;
}
