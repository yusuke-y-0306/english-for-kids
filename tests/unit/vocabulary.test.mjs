import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { describe } from "node:test";

import { buildCategories, wordId } from "../../src/lib/vocabulary/load.ts";

/**
 * 語彙コンテンツの検証 — issue #83
 *
 * ここで固定したいのは 2 つ。
 *
 * 1. 48 語が **コードではなく JSON** から読めること (`words.ts` が唯一の正でなくなる)
 * 2. `id` が `en` と独立していること — 綴りを直しても進捗キーが動かない
 */

const DIRECTORY = "content/vocabulary";
const REGISTRY = "src/lib/vocabulary/registry.ts";

async function jsonFiles() {
  return (await readdir(DIRECTORY)).filter((name) => name.endsWith(".json")).sort();
}

/** 実ファイルを `buildCategories()` に渡せる形にする */
async function loadSources() {
  const sources = [];
  for (const name of await jsonFiles()) {
    const relative = path.posix.join(DIRECTORY, name);
    sources.push({
      path: relative,
      data: JSON.parse(await readFile(relative, "utf8")),
    });
  }
  return sources;
}

describe("content/vocabulary", () => {
  test("既存 48 語が JSON から読める (6 カテゴリ)", async () => {
    const categories = buildCategories(await loadSources());
    assert.equal(categories.length, 6);
    assert.equal(
      categories.reduce((total, category) => total + category.words.length, 0),
      48,
    );

    const animals = categories.find((category) => category.id === "animals");
    assert.ok(animals);
    assert.deepEqual(
      animals.words.map((word) => word.id),
      [
        "animals/dog",
        "animals/cat",
        "animals/bird",
        "animals/fish",
        "animals/lion",
        "animals/elephant",
        "animals/rabbit",
        "animals/bear",
      ],
    );
    assert.equal(animals.words[0].ja, "いぬ");
    assert.equal(animals.words[0].emoji, "🐶");
  });

  test("全 ID が一意で、保存キーは JSON の id そのもの", async () => {
    const categories = buildCategories(await loadSources());
    const ids = categories.flatMap((category) =>
      category.words.map((word) => wordId(word)),
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("family/mother"));
  });

  test("en を書き換えても id は変わらない (学習履歴が切れない)", async () => {
    const sources = await loadSources();
    const animals = sources.find((source) => source.path.endsWith("animals.json"));
    assert.ok(animals);

    const edited = structuredClone(animals);
    edited.data.words[0].en = "dawg";
    edited.data.words[0].ja = "わんちゃん";

    const [before] = buildCategories([animals]);
    const [after] = buildCategories([edited]);

    assert.equal(before.words[0].id, "animals/dog");
    assert.equal(after.words[0].id, "animals/dog");
    assert.equal(wordId(after.words[0]), "animals/dog");
    assert.equal(after.words[0].en, "dawg");
  });

  test("registry.ts がディレクトリ内の全ファイルを読み、余計な参照も無い", async () => {
    const source = await readFile(REGISTRY, "utf8");
    /* import 文と sources の両方にパスが出るので重複は畳む */
    const referenced = [
      ...new Set(
        [...source.matchAll(/content\/vocabulary\/([a-z0-9-]+\.json)/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort();
    assert.deepEqual(referenced, await jsonFiles());
  });
});

describe("buildCategories の検証", () => {
  const valid = () => ({
    path: "content/vocabulary/animals.json",
    data: {
      id: "animals",
      label: "動物",
      emoji: "🐾",
      color: "from-amber-300 to-orange-400",
      words: [
        {
          id: "animals/dog",
          en: "dog",
          ja: "いぬ",
          emoji: "🐶",
          pos: "noun",
          level: "pre-a1",
          audio: null,
        },
      ],
    },
  });

  test("ID の重複は落ちる", () => {
    const source = valid();
    source.data.words.push(structuredClone(source.data.words[0]));
    assert.throws(() => buildCategories([source]), /duplicate word id "animals\/dog"/);
  });

  test("必須項目 (level) の欠落は落ちる", () => {
    const source = valid();
    delete source.data.words[0].level;
    assert.throws(() => buildCategories([source]), /level: must be one of/);
  });

  test("カテゴリと ID の不一致 (未知カテゴリ) は落ちる", () => {
    const source = valid();
    source.data.words[0].id = "zoo/dog";
    assert.throws(() => buildCategories([source]), /must start with "animals\/"/);
  });

  test("未知フィールド (typo) は落ちる", () => {
    const source = valid();
    source.data.words[0].levle = "a1";
    assert.throws(() => buildCategories([source]), /unknown field "levle"/);
  });

  test("audio は null か / 始まりのパスだけ", () => {
    const source = valid();
    source.data.words[0].audio = "audio/dog.mp3";
    assert.throws(() => buildCategories([source]), /"audio" must be null or a public path/);

    source.data.words[0].audio = "/audio/animals/dog.mp3";
    assert.equal(buildCategories([source])[0].words[0].audio, "/audio/animals/dog.mp3");
  });

  test("品詞とレベルは列挙値だけ", () => {
    const source = valid();
    source.data.words[0].pos = "名詞";
    assert.throws(() => buildCategories([source]), /pos: must be one of/);

    source.data.words[0].pos = "noun";
    source.data.words[0].level = "b1";
    assert.throws(() => buildCategories([source]), /level: must be one of/);
  });
});
