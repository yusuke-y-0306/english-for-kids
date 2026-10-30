/**
 * 発音認識の計測 — 収録側 (issue #40)
 *
 * ここでやること:
 *  1. 単語を 1 つずつ表示し、マイクから 4 秒録る
 *  2. (任意) 同じタイミングで端末内 SpeechRecognition を回し、仮説を控える
 *  3. 16kHz / モノラル / PCM16 の WAV にして JSON にまとめ、ダウンロードさせる
 *
 * ここでやらないこと:
 *  - サーバへの送信 (音声もテキストも出さない)
 *  - 判定 (採点は report.mjs がアプリと同じ `scorePronunciation()` で行う)
 *
 * 注意: 端末内認識はマイクの生入力を要求するので、録音した WAV を入力に使えない。
 * そのため「同じ単語を続けて 2 回しゃべる」のではなく「1 回の発話を録音と認識で
 * **同時に**取る」。ただし認識側の前処理 (AEC/NS) はブラウザ任せなので、
 * 厳密に同一音声ではない。比較の解釈は README を参照。
 */

const TARGET_SAMPLE_RATE = 16000;
const RECORD_MS = 4000;
const AVAILABILITY_TIMEOUT_MS = 1500;
const RECOGNIZE_TIMEOUT_MS = 8000;
/**
 * 資産のパスは**絶対パス**で書く。
 * `/lab/asr-bench` (末尾スラッシュなし) でも配るように rewrite してあるので、
 * 相対パスだと `/lab/words.json` に化けて 404 になる。
 */
const WORDS_URL = "/lab/asr-bench/words.json";
const WORKLET_URL = "/lab/asr-bench/recorder-worklet.js";

const el = (id) => document.getElementById(id);

const state = {
  words: [],
  index: 0,
  clips: [],
  audioContext: null,
  deviceReport: null,
  busy: false,
};

function log(message) {
  const node = el("log");
  node.textContent += `${message}\n`;
  node.scrollTop = node.scrollHeight;
}

function setStatus(message) {
  el("status").textContent = message;
}

function setBusy(busy) {
  state.busy = busy;
  el("record").disabled = busy;
  el("skip").disabled = busy;
}

/* ------------------------------------------------------------------ *
 * 録音
 * ------------------------------------------------------------------ */

async function ensureAudioContext() {
  if (state.audioContext) return state.audioContext;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("この端末には AudioContext がありません");
  // サンプルレートは端末に任せる (Safari は AudioContext に 16kHz を指定できない)。
  // 変換は resampleTo16k() で明示的に行う。
  const ctx = new Ctx();
  await ctx.audioWorklet.addModule(WORKLET_URL);
  state.audioContext = ctx;
  return ctx;
}

/** Float32 の配列を 16kHz モノラルへ (Safari 対策で必ず明示リサンプルする) */
async function resampleTo16k(samples, inputRate) {
  if (inputRate === TARGET_SAMPLE_RATE) return samples;
  const frames = Math.max(1, Math.round((samples.length * TARGET_SAMPLE_RATE) / inputRate));
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) {
    // オフラインのレンダラが無い実装では、素朴な間引きで代用する (精度は落ちる)
    const out = new Float32Array(frames);
    const ratio = inputRate / TARGET_SAMPLE_RATE;
    for (let i = 0; i < frames; i += 1) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] || 0;
    return out;
  }
  const offline = new Offline(1, frames, TARGET_SAMPLE_RATE);
  const buffer = offline.createBuffer(1, samples.length, inputRate);
  buffer.copyToChannel(samples, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice(0);
}

/** 前後の無音を落とす (推論の無駄を減らす。判定には影響しない) */
function trimSilence(samples, rate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return samples;
  const threshold = peak * 0.05;
  let start = 0;
  let end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1;
  while (end > start && Math.abs(samples[end]) < threshold) end -= 1;
  const pad = Math.round(rate * 0.15);
  start = Math.max(0, start - pad);
  end = Math.min(samples.length - 1, end + pad);
  return samples.slice(start, end + 1);
}

/** PCM16 の WAV に包む */
function encodeWav(samples, rate) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function recordClip() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // 端末側の加工を切って「マイクそのまま」を測る
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  try {
    const ctx = await ensureAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "asr-capture");
    const chunks = [];
    node.port.onmessage = (event) => chunks.push(event.data);
    // ワークレットを動かし続けるため、無音を destination に流す
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
    const elapsedMs = Math.round(performance.now() - startedAt);

    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    mute.disconnect();

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (!total) throw new Error("音が取れませんでした");
    const raw = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.length;
    }
    const mono = await resampleTo16k(raw, ctx.sampleRate);
    const trimmed = trimSilence(mono, TARGET_SAMPLE_RATE);
    return {
      wavBase64: toBase64(encodeWav(trimmed, TARGET_SAMPLE_RATE)),
      sampleRate: TARGET_SAMPLE_RATE,
      seconds: Number((trimmed.length / TARGET_SAMPLE_RATE).toFixed(2)),
      capturedMs: elapsedMs,
      deviceRate: ctx.sampleRate,
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/* ------------------------------------------------------------------ *
 * 端末内認識 (アプリ本体と同じ条件で回す)
 * ------------------------------------------------------------------ */

function getCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/** アプリと同じ判定 (`detectDeviceRecognition` 相当) */
async function probeDevice() {
  const Ctor = getCtor();
  if (!Ctor) return { present: false, hasProcessLocally: false };
  const hasProcessLocally = "processLocally" in Ctor.prototype;
  if (!hasProcessLocally) return { present: true, hasProcessLocally: false };
  if (typeof Ctor.available !== "function") {
    return { present: true, hasProcessLocally: true, availability: undefined };
  }
  try {
    const value = await Promise.race([
      Promise.resolve(Ctor.available({ langs: ["en-US"], processLocally: true })),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), AVAILABILITY_TIMEOUT_MS)),
    ]);
    return { present: true, hasProcessLocally: true, availability: String(value) };
  } catch (error) {
    log(`available() が失敗しました: ${String(error)}`);
    return { present: true, hasProcessLocally: true, availability: "error" };
  }
}

function recognizeDevice() {
  return new Promise((resolve, reject) => {
    const Ctor = getCtor();
    if (!Ctor) {
      reject(new Error("SpeechRecognition がありません"));
      return;
    }
    const recognizer = new Ctor();
    recognizer.processLocally = true;
    if (recognizer.processLocally !== true) {
      reject(new Error("processLocally を指定できませんでした (クラウド実装なので使わない)"));
      return;
    }
    recognizer.lang = "en-US";
    recognizer.continuous = false;
    recognizer.interimResults = false;

    let settled = false;
    const startedAt = performance.now();
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        recognizer.stop();
      } catch {
        // すでに止まっている
      }
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("timeout"))),
      RECOGNIZE_TIMEOUT_MS,
    );

    recognizer.onresult = (event) => {
      const results = event.results;
      let transcript = "";
      if (results) {
        for (let i = event.resultIndex || 0; i < results.length; i += 1) {
          const alternative = results[i] && results[i][0];
          if (alternative && alternative.transcript) transcript += alternative.transcript;
        }
      }
      const text = transcript.trim();
      const ms = Math.round(performance.now() - startedAt);
      if (!text) {
        finish(() => reject(new Error("empty")));
        return;
      }
      finish(() => resolve({ transcript: text, ms }));
    };
    recognizer.onerror = (event) => {
      const code = (event && event.error) || "unknown";
      finish(() => reject(new Error(code)));
    };
    recognizer.onend = () => finish(() => reject(new Error("empty")));

    try {
      recognizer.start();
    } catch (error) {
      finish(() => reject(new Error((error && error.name) || "start-failed")));
    }
  });
}

/* ------------------------------------------------------------------ *
 * 画面
 * ------------------------------------------------------------------ */

function renderRow(clip) {
  const row = document.createElement("div");
  row.className = "row";
  const left = document.createElement("span");
  left.textContent = `${clip.expected} (${clip.seconds}s)`;
  const right = document.createElement("span");
  if (clip.device && clip.device.transcript) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${clip.device.transcript} / ${clip.device.ms}ms`;
    right.appendChild(tag);
  } else if (clip.device && clip.device.error) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `認識なし: ${clip.device.error}`;
    right.appendChild(tag);
  } else {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "録音のみ";
    right.appendChild(tag);
  }
  row.appendChild(left);
  row.appendChild(right);
  el("rows").appendChild(row);
}

function showWord() {
  const word = state.words[state.index];
  if (!word) {
    el("word-en").textContent = "おわり";
    el("word-ja").textContent = "「結果を JSON で保存」を押してください";
    el("record").disabled = true;
    setStatus(`${state.clips.length} 件とりました`);
    return;
  }
  el("word-en").textContent = word.en;
  el("word-ja").textContent = word.ja || "";
  setStatus(`のこり ${state.words.length - state.index} 語`);
}

async function captureWord() {
  const word = state.words[state.index];
  if (!word || state.busy) return;
  setBusy(true);
  el("record").disabled = true;

  let device = null;
  const withDevice = el("with-device").checked && state.deviceReport && state.deviceReport.present;

  // 認識と録音は同時に走らせる (1 回の発話を両方で観測する)
  let recognizing = null;
  if (withDevice) {
    recognizing = recognizeDevice().catch((error) => ({ error: String((error && error.message) || error) }));
    recognizing.then((result) => log(`認識: ${JSON.stringify(result)}`));
  }

  try {
    setStatus(`「${word.en}」を とっています… (${RECORD_MS / 1000} 秒)`);
    const clip = await recordClip();
    if (recognizing) {
      setStatus("認識の こたえを まっています…");
      device = await recognizing;
    }
    const entry = {
      wordId: word.id,
      expected: word.en,
      seconds: clip.seconds,
      deviceRate: clip.deviceRate,
      sampleRate: clip.sampleRate,
      wavBase64: clip.wavBase64,
      device: device || null,
    };
    state.clips.push(entry);
    renderRow(entry);
    el("save").disabled = false;
  } catch (error) {
    setStatus("とれませんでした");
    log(`エラー: ${String((error && error.message) || error)}`);
  } finally {
    setBusy(false);
    state.index += 1;
    showWord();
    if (state.words[state.index]) el("record").disabled = false;
  }
}

function saveJson() {
  const payload = {
    kind: "english-for-kids/asr-bench",
    version: 1,
    collectedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    deviceReport: state.deviceReport,
    clips: state.clips,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = payload.collectedAt.replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `asr-bench-${stamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus("保存しました（Downloads を確認してください）");
}

async function main() {
  el("record").addEventListener("click", () => void captureWord());
  el("skip").addEventListener("click", () => {
    state.index += 1;
    showWord();
    el("record").disabled = !state.words[state.index];
  });
  el("save").addEventListener("click", saveJson);

  try {
    const response = await fetch(WORDS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`words.json が読めません (${response.status})`);
    state.words = await response.json();
  } catch (error) {
    setStatus("単語リストが読めません");
    log(String(error));
    return;
  }

  state.deviceReport = await probeDevice();
  log(`端末内認識: ${JSON.stringify(state.deviceReport)}`);
  if (state.deviceReport.present && state.deviceReport.availability === "available") {
    el("with-device").checked = true;
  }
  el("with-device").addEventListener("change", (event) => {
    if (event.target.checked) log("端末内認識も ためします (テスト用 Chromium では ページが落ちることがあります)");
  });

  showWord();
}

void main();
