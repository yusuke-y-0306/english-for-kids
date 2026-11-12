"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PrivacyNotice from "@/components/speech/PrivacyNotice";
import RecognitionPathBadge from "@/components/speech/RecognitionPathBadge";
import SelfReportPrompt from "@/components/speech/SelfReportPrompt";
import {
  DeviceRecognitionError,
  createDeviceRecognizer,
  listenOnce,
  resolveRecognitionSetup,
} from "@/lib/speech/device-recognition";
import type { RecognitionPath } from "@/lib/speech/recognition-policy";
import type { PronunciationScore } from "@/lib/speech/scores";
import { scorePronunciation } from "@/lib/speech/scoring";
import {
  WasmRecognitionError,
  detectWasmReadiness,
  listenOnceWithWasm,
  prepareWasm,
  type PrepareStage,
  type WasmReadiness,
} from "@/lib/speech/wasm-recognition";
import { categories, wordId } from "@/lib/words";

/**
 * 発音練習の画面 — issue #2
 *
 * 設計の要点:
 *  - 認識の経路は `resolveRecognitionSetup()` に**決めさせる**。画面が独断で
 *    `SpeechRecognition` を触らない (クラウド経路に落ちる事故を防ぐ / issue #31)。
 *  - Safari は device が使えないため、アプリ内モデル (wasm) とその「じゅんび」を
 *    同じ判定に含める (issue #79)。
 *  - 判定は端末内で完結する純粋関数 (`scorePronunciation`)。
 *  - 保存するのは**単語 ID と 3 段階スコアだけ**。音声も認識テキストも送らない (issue #32)。
 *  - 記録に失敗しても練習は止めない (子どもの学習を通信の都合で妨げない)。
 */

type PracticeWord = {
  id: string;
  en: string;
  ja: string;
  emoji: string;
  /** 同音語 (two → "too")。採点で ok として吸収する */
  homophones?: string[];
  /** 言い換え (mother → "mom")。採点では close 止まり */
  variants?: string[];
};

const PRACTICE_WORDS: PracticeWord[] = categories.flatMap((category) =>
  category.words.map((word) => ({
    id: wordId(category.id, word),
    en: word.en,
    ja: word.ja,
    emoji: word.emoji,
  })),
);

type Phase = "ready" | "listening" | "scored";

type Decision = { path: RecognitionPath; reason: string; canPrepareWasm: boolean };

type Result = {
  score: PronunciationScore;
  hint: string;
  transcript?: string;
};

const SCORE_STYLE: Record<PronunciationScore, { emoji: string; ring: string; text: string }> = {
  ok: { emoji: "🎉", ring: "border-emerald-300 bg-emerald-50", text: "text-emerald-800" },
  close: { emoji: "😊", ring: "border-amber-300 bg-amber-50", text: "text-amber-800" },
  retry: { emoji: "🔁", ring: "border-sky-300 bg-sky-50", text: "text-sky-800" },
};

/** じゅんび中のボタン文言。段階と経過秒を出して「止まっていない」ことを伝える */
function prepareLabel(
  preparing: { fraction: number | null; stage: PrepareStage },
  elapsedSec: number,
): string {
  switch (preparing.stage) {
    case "download":
      return preparing.fraction === null
        ? `じゅんび中… ${elapsedSec}びょう`
        : `じゅんび中… ${Math.round(preparing.fraction * 100)}%`;
    case "verify":
      return `モデルを かくにん中… ${elapsedSec}びょう`;
    case "engine":
      return `エンジンを よみこみ中… ${elapsedSec}びょう`;
    case "model":
      return `モデルを よみこみ中… ${elapsedSec}びょう`;
  }
}

export default function PronunciationPanel() {
  const [wordIndex, setWordIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<Result | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [readiness, setReadiness] = useState<WasmReadiness | null>(null);
  const [preparing, setPreparing] = useState<{
    fraction: number | null;
    stage: PrepareStage;
    since: number;
  } | null>(null);
  /** 経過秒の再計算用 (タイマーで進めるだけ) */
  const [now, setNow] = useState(0);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  /** 認識できなかった等の短い案内 (採点結果とは別に出す) */
  const [notice, setNotice] = useState<string | null>(null);

  const word = PRACTICE_WORDS[wordIndex];

  /* じゅんび中は経過秒を出す。「止まっている」のか「時間がかかっている」のか
     見分けられるようにする (Safari はモデルの読み込みに数十秒かかる) */
  const prepareSince = preparing?.since ?? null;
  useEffect(() => {
    if (prepareSince === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [prepareSince]);
  const prepareElapsed = prepareSince === null ? 0 : Math.max(0, Math.round((now - prepareSince) / 1000));

  // 経路の判定はブラウザ API を触るので、描画中ではなくマウント後に 1 回だけ行う。
  // Safari は device が必ず使えないので、wasm の準備状態 (#79) が体験を決める。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const wasmReadiness = await detectWasmReadiness();
      if (!alive) return;
      setReadiness(wasmReadiness);
      const resolved = await resolveRecognitionSetup(wasmReadiness);
      if (!alive) return;
      setDecision({
        path: resolved.path,
        reason: resolved.reason,
        canPrepareWasm: resolved.canPrepareWasm,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 初回のじゅんび (51MB)。押されたときだけ落とす。 */
  const prepare = useCallback(async () => {
    if (preparing) return;
    setPrepareError(null);
    setNotice(null);
    setPreparing({ fraction: null, stage: "download", since: Date.now() });
    try {
      await prepareWasm({
        onProgress: (progress) =>
          setPreparing((current) =>
            current === null ? current : { ...current, fraction: progress.fraction },
          ),
        onStage: (stage) =>
          setPreparing((current) => (current === null ? current : { ...current, stage })),
      });
      const resolved = await resolveRecognitionSetup("ready");
      setReadiness("ready");
      setDecision({
        path: resolved.path,
        reason: resolved.reason,
        canPrepareWasm: resolved.canPrepareWasm,
      });
      setPreparing(null);
    } catch (error) {
      setPreparing(null);
      console.error("[asr] prepare failed", error);
      const detail = error instanceof Error && error.message ? `（${error.message}）` : "";
      setPrepareError(
        `じゅんびが できませんでした${detail}。でんぱの いい ところで もういちど ためしてね`,
      );
    }
  }, [preparing]);

  /** 記録は投げっぱなし。失敗しても練習は止めない。 */
  const save = useCallback(async (id: string, score: PronunciationScore) => {
    try {
      await fetch("/api/pronunciation/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // userId は送らない (サーバがセッションから決める)
        body: JSON.stringify({ wordId: id, score }),
      });
    } catch {
      // 学習の妨げにしない
    }
  }, []);

  const finish = useCallback(
    (score: PronunciationScore, hint: string, transcript?: string) => {
      setResult({ score, hint, transcript });
      setPhase("scored");
      void save(word.id, score);
    },
    [save, word.id],
  );

  /** 端末内で 1 回だけ聞き取る (device / wasm のどちらでも) */
  const listen = useCallback(async () => {
    if (!decision || phase === "listening") return;
    setPhase("listening");
    setResult(null);
    setNotice(null);
    try {
      const transcript =
        decision.path === "wasm"
          ? await listenOnceWithWasm()
          : (await listenOnce(createDeviceRecognizer(decision))).transcript;
      // 同音語・言い換えは単語データ側の許容を渡して吸収する (issue #40)
      const scored = scorePronunciation(transcript, word.en, {
        homophones: word.homophones,
        variants: word.variants,
      });
      finish(scored.score, scored.hint, transcript);
    } catch (error) {
      if (error instanceof WasmRecognitionError) {
        setPhase("ready");
        if (error.kind === "empty" || error.kind === "timeout") {
          /* 聞こえなかっただけ。経路は変えず、もう一度いってもらう */
          setNotice("きこえなかったよ。ゆっくり いってみよう");
          return;
        }
        if (error.kind === "mic") {
          setNotice("マイクが つかえませんでした。マイクの きょかを かくにん してね");
          return;
        }
        /* エンジン/モデルの失敗は、その場で自己申告に切り替える (練習を止めない)。
           キャッシュが消えていた場合に備えて、準備状態を読み直してから案内する */
        const wasmReadiness = await detectWasmReadiness().catch((): WasmReadiness => "unsupported");
        setReadiness(wasmReadiness);
        setDecision({
          path: "self-report",
          reason: "アプリ内の よみとりが できませんでした",
          canPrepareWasm: wasmReadiness === "needs-download",
        });
        return;
      }
      // 端末内と証明できない/エラーが出た経路は**リトライしない**。
      // そのまま自己申告に切り替える (issue #31 の方針)。
      if (error instanceof DeviceRecognitionError) {
        setDecision({
          path: "self-report",
          reason:
            error.failure.kind === "not-local"
              ? error.failure.reason
              : "端末内の よみとりが できませんでした",
          canPrepareWasm: readiness === "needs-download",
        });
      }
      setPhase("ready");
    }
  }, [decision, finish, phase, readiness, word.en, word.homophones, word.variants]);

  /** 自己申告 (最後の砦) */
  const selfReport = useCallback(
    (said: boolean) => {
      if (said) finish("ok", "いえたね！");
      else finish("retry", "もういちど いってみよう");
    },
    [finish],
  );

  const retry = useCallback(() => {
    setResult(null);
    setNotice(null);
    setPhase("ready");
  }, []);

  const nextWord = useCallback(() => {
    setResult(null);
    setNotice(null);
    setPhase("ready");
    setWordIndex((current) => {
      if (PRACTICE_WORDS.length <= 1) return current;
      let next = current;
      while (next === current) next = Math.floor(Math.random() * PRACTICE_WORDS.length);
      return next;
    });
  }, []);

  const path = decision?.path ?? null;
  const style = result ? SCORE_STYLE[result.score] : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold text-ink sm:text-lg">発音練習</h1>
        {path ? <RecognitionPathBadge path={path} /> : <span className="w-20" />}
      </header>

      <PrivacyNotice />

      <section className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
        <p className="text-sm font-bold text-ink-soft">この ことばを いってみよう</p>
        <div className="text-7xl drop-shadow-sm" aria-hidden>
          {word.emoji}
        </div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          {word.en}
        </p>
        <p className="text-lg font-bold text-ink-soft">{word.ja}</p>

        {decision === null && <p className="text-sm text-ink-soft">よみこみ中…</p>}

        {(decision?.path === "device" || decision?.path === "wasm") && (
          <button
            type="button"
            onClick={() => void listen()}
            disabled={phase === "listening"}
            className="rounded-full bg-[#ff8fb0] px-8 py-3 text-lg font-extrabold text-white shadow-[0_4px_0_rgba(176,58,99,0.35)] transition active:translate-y-0.5 active:shadow-none disabled:opacity-60"
          >
            {phase === "listening" ? "きいてるよ…" : "🎤 はなす"}
          </button>
        )}

        {/* Safari など device が使えない端末: モデル未取得なら「じゅんび」を出す。
            勝手に 51MB を落とさない (押されたときだけ)。 */}
        {decision?.canPrepareWasm && readiness === "needs-download" && (
          <div className="w-full max-w-sm rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-left">
            <p className="text-xs leading-relaxed font-bold text-amber-900">
              この端末では クラウドの よみとりを つかいません。アプリに モデルを ようい すると、
              こえを おくらずに よみとり できます。
            </p>
            <button
              type="button"
              onClick={() => void prepare()}
              disabled={preparing !== null}
              className="mt-2 w-full rounded-full bg-[#f4801f] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_#c25f0d] transition active:translate-y-0.5 active:shadow-none disabled:opacity-60"
            >
              {preparing === null
                ? "🔊 こえの じゅんび（51MB）"
                : prepareLabel(preparing, prepareElapsed)}
            </button>
            {preparing !== null && (
              <p className="mt-2 text-xs leading-relaxed font-bold text-amber-900">
                さいしょの 1 回だけ、1〜2 ぷん かかることが あります。
              </p>
            )}
            {prepareError && <p className="mt-2 text-xs font-bold text-red-700">{prepareError}</p>}
          </div>
        )}

        {/* 自己申告は「まだ判定していないとき」だけ出す。結果が出たあとに
            「もういちど」が 2 つ並ぶのを避ける。 */}
        {decision?.path === "self-report" && !result && (
          <div className="w-full max-w-sm">
            <SelfReportPrompt word={word.en} onAnswer={selfReport} />
          </div>
        )}

        {notice && !result && (
          <p aria-live="polite" className="text-sm font-bold text-[#b03a63]">
            {notice}
          </p>
        )}

        {result && style && (
          <div
            aria-live="polite"
            className={`w-full max-w-sm rounded-xl border-2 p-4 ${style.ring} ${style.text}`}
          >
            <p className="text-2xl font-extrabold">
              {style.emoji} {result.hint}
            </p>
            {result.transcript && (
              <p className="mt-1 text-sm opacity-80">きこえた ことば: “{result.transcript}”</p>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-full border-2 border-[#c98b5e] bg-white px-6 py-2.5 text-sm font-extrabold text-[#5b4a3c] shadow transition hover:bg-[#fff6e3] disabled:opacity-50"
          disabled={phase === "listening"}
        >
          もういちど
        </button>
        <button
          type="button"
          onClick={nextWord}
          className="rounded-full bg-[#4dc9f6] px-6 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_rgba(26,111,149,0.35)] transition active:translate-y-0.5 active:shadow-none"
        >
          つぎの ことば →
        </button>
      </div>

      {/* 理由は「なぜ自己申告なのか」を説明するときだけ出す (端末内経路はバッジで十分) */}
      {decision?.path === "self-report" && (
        <p className="text-center text-sm text-[#6b5847]">{decision.reason}</p>
      )}
    </main>
  );
}
