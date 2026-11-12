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
  resolveRecognitionDecision,
} from "@/lib/speech/device-recognition";
import type { RecognitionPath } from "@/lib/speech/recognition-policy";
import type { PronunciationScore } from "@/lib/speech/scores";
import { scorePronunciation } from "@/lib/speech/scoring";
import { categories, wordId } from "@/lib/words";

/**
 * 発音練習の画面 — issue #2
 *
 * 設計の要点:
 *  - 認識の経路は `resolveRecognitionDecision()` に**決めさせる**。画面が独断で
 *    `SpeechRecognition` を触らない (クラウド経路に落ちる事故を防ぐ / issue #31)。
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

type Decision = { path: RecognitionPath; reason: string };

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

export default function PronunciationPanel() {
  const [wordIndex, setWordIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<Result | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const word = PRACTICE_WORDS[wordIndex];

  // 経路の判定はブラウザ API を触るので、描画中ではなくマウント後に 1 回だけ行う。
  useEffect(() => {
    let alive = true;
    // TODO(#40): WASM 推論エンジンを組み込んだら、ここを
    // `await isModelReady() && engine.available()` に置き換える。
    // それまでは「端末内認識 → 自己申告」の 2 経路で動かす。
    // 優先順位は policy 側 (device → wasm → self-report) が持つので、
    // ここは「wasm がまだ無い」ことを伝えるだけでよい。
    void resolveRecognitionDecision(false).then((resolved) => {
      if (!alive) return;
      setDecision({ path: resolved.path, reason: resolved.reason });
    });
    return () => {
      alive = false;
    };
  }, []);

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

  /** 端末内認識で 1 回だけ聞き取る */
  const listen = useCallback(async () => {
    if (!decision || phase === "listening") return;
    setPhase("listening");
    setResult(null);
    try {
      const recognizer = createDeviceRecognizer(decision);
      const { transcript } = await listenOnce(recognizer);
      // 同音語・言い換えは単語データ側の許容を渡して吸収する (issue #40)
      const scored = scorePronunciation(transcript, word.en, {
        homophones: word.homophones,
        variants: word.variants,
      });
      finish(scored.score, scored.hint, transcript);
    } catch (error) {
      // 端末内と証明できない/エラーが出た経路は**リトライしない**。
      // そのまま自己申告に切り替える (issue #31 の方針)。
      if (error instanceof DeviceRecognitionError) {
        setDecision({
          path: "self-report",
          reason:
            error.failure.kind === "not-local"
              ? error.failure.reason
              : "端末内の よみとりが できませんでした",
        });
      }
      setPhase("ready");
    }
  }, [decision, finish, phase, word.en, word.homophones, word.variants]);

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
    setPhase("ready");
  }, []);

  const nextWord = useCallback(() => {
    setResult(null);
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

        {decision?.path === "device" && (
          <button
            type="button"
            onClick={() => void listen()}
            disabled={phase === "listening"}
            className="rounded-full bg-[#ff8fb0] px-8 py-3 text-lg font-extrabold text-white shadow-[0_4px_0_rgba(176,58,99,0.35)] transition active:translate-y-0.5 active:shadow-none disabled:opacity-60"
          >
            {phase === "listening" ? "きいてるよ…" : "🎤 はなす"}
          </button>
        )}

        {/* 自己申告は「まだ判定していないとき」だけ出す。結果が出たあとに
            「もういちど」が 2 つ並ぶのを避ける。 */}
        {decision?.path === "self-report" && !result && (
          <div className="w-full max-w-sm">
            <SelfReportPrompt word={word.en} onAnswer={selfReport} />
          </div>
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
