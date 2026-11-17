import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";
import { pathToFileURL } from "node:url";

/**
 * 単語の読み上げ再生 — issue #84
 *
 * DOM は無いので、`window` / `Audio` / `SpeechSynthesisUtterance` を最小限だけ
 * 差し替えて「鳴らす順番」「多重再生しない」「ミュート」「フォールバック」を固定する。
 * 音そのものの品質はテストできない (そこは生成物と耳で見る)。
 */

register("./ts-loader.mjs", pathToFileURL(import.meta.filename));

class FakeAudio {
  static instances = [];
  static plays = [];
  static pauses = 0;

  constructor() {
    this.src = "";
    this.currentTime = 0;
    this.preload = "";
    this.paused = true;
    FakeAudio.instances.push(this);
  }

  play() {
    if (this.src.includes("broken")) {
      return Promise.reject(new Error("decode error"));
    }
    this.paused = false;
    FakeAudio.plays.push(this.src);
    return Promise.resolve();
  }

  pause() {
    FakeAudio.pauses += 1;
    this.paused = true;
  }
}

function installBrowser() {
  const store = new Map();
  const target = new EventTarget();
  const spoken = [];

  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
    dispatchEvent: (event) => target.dispatchEvent(event),
    speechSynthesis: {
      cancel() {},
      speak(utterance) {
        spoken.push(utterance);
      },
    },
  };
  globalThis.Audio = FakeAudio;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };

  return { store, spoken };
}

const browser = installBrowser();
const { playWordAudio, stopWordAudio } = await import("../../src/lib/audio/play.ts?word-audio-test");
const { setMuted } = await import("../../src/lib/audio/settings.ts");

const DOG = { id: "animals/dog", en: "dog", audio: "/audio/words/animals/dog.mp3" };
const CAT = { id: "animals/cat", en: "cat", audio: "/audio/words/animals/cat.mp3" };

describe("playWordAudio", () => {
  test("生成済みの音声を再生する", async () => {
    const outcome = await playWordAudio(DOG);
    assert.equal(outcome, "played");
    assert.equal(FakeAudio.plays.at(-1), DOG.audio);
    assert.equal(browser.spoken.length, 0, "端末 TTS は使わない");
  });

  test("連打しても音が重ならない (前の再生を止める)", async () => {
    const pausesBefore = FakeAudio.pauses;
    await playWordAudio(CAT);
    assert.ok(FakeAudio.pauses > pausesBefore, "前の音は止める (pause が呼ばれる)");
    assert.equal(FakeAudio.instances.length, 1, "Audio 要素は使い回す");
    assert.deepEqual(FakeAudio.plays.slice(-2), [DOG.audio, CAT.audio]);
  });

  test("audio が無ければ端末 TTS で読む", async () => {
    const outcome = await playWordAudio({ id: "animals/bird", en: "bird", audio: null });
    assert.equal(outcome, "fallback");
    assert.equal(browser.spoken.at(-1).text, "bird");
    assert.equal(browser.spoken.at(-1).lang, "en-US");
  });

  test("再生に失敗したら端末 TTS にフォールバックする", async () => {
    const before = FakeAudio.plays.length;
    const outcome = await playWordAudio({ id: "animals/fish", en: "fish", audio: "/broken.mp3" });
    assert.equal(outcome, "fallback");
    assert.equal(FakeAudio.plays.length, before, "壊れた音声は鳴った扱いにしない");
    assert.equal(browser.spoken.at(-1).text, "fish");
  });

  test("ミュート中は何も鳴らさない", async () => {
    setMuted(true);
    try {
      const plays = FakeAudio.plays.length;
      const spoken = browser.spoken.length;
      assert.equal(await playWordAudio(DOG), "muted");
      assert.equal(FakeAudio.plays.length, plays);
      assert.equal(browser.spoken.length, spoken);
    } finally {
      setMuted(false);
    }
  });

  test("stopWordAudio は再生を止める", async () => {
    await playWordAudio(DOG);
    const player = FakeAudio.instances.at(-1);
    assert.equal(player.paused, false);
    stopWordAudio();
    assert.equal(player.paused, true);
  });
});

describe("audio settings", () => {
  test("既定は ON (ミュートしない)", async () => {
    const fresh = await import("../../src/lib/audio/settings.ts?settings-default");
    assert.equal(fresh.isMuted(), false);
  });

  test("保存した値が次回も効く", async () => {
    const fresh = await import("../../src/lib/audio/settings.ts?settings-persist");
    fresh.setMuted(true);
    assert.equal(browser.store.get("kodomo-eigo-audio-muted-v1"), "1");

    const reloaded = await import("../../src/lib/audio/settings.ts?settings-reload");
    assert.equal(reloaded.isMuted(), true);
    reloaded.setMuted(false);
    assert.equal(browser.store.get("kodomo-eigo-audio-muted-v1"), "0");
  });

  test("クイズ単体の古いミュート設定を引き継ぐ", async () => {
    const saved = new Map(browser.store);
    browser.store.clear();
    browser.store.set("kodomo-eigo-quiz-mute-v1", "1");
    try {
      const fresh = await import("../../src/lib/audio/settings.ts?settings-legacy");
      assert.equal(fresh.isMuted(), true);
    } finally {
      browser.store.clear();
      for (const [key, value] of saved) browser.store.set(key, value);
    }
  });

  test("切り替えは購読者に通知される", async () => {
    const fresh = await import("../../src/lib/audio/settings.ts?settings-subscribe");
    let calls = 0;
    const unsubscribe = fresh.subscribeMuted(() => {
      calls += 1;
    });
    fresh.setMuted(true);
    assert.equal(calls, 1);
    fresh.setMuted(false);
    assert.equal(calls, 2);
    unsubscribe();
  });
});
