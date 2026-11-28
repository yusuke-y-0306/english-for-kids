"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MuteToggle } from "@/components/audio/MuteToggle";
import { playWordAudio, stopWordAudio } from "@/lib/audio/play";
import { newClientId } from "@/lib/client-id";
import {
  PHONICS_ROUND_SIZE,
  familyChoices,
  familySuffix,
  initialChoices,
  initialOf,
  letterChoices,
  pickRound,
  type PhonicsWord,
} from "@/lib/phonics";
import { categories } from "@/lib/words";

/**
 * フォニックスの練習画面 — issue #88
 *
 * 3 つのモードを 1 画面にまとめる。どれも「音 → 文字」の結び付けが目的で、
 * 文字が読めない子でも絵と音だけで解けるようにしてある。
 *
 *   1. おとを きいて もじを えらぶ  (フォニーム音 → 文字)
 *   2. さいしょの もじを えらぶ    (代表語 → 頭文字)
 *   3. おなじ おとの ことばを あつめる (word family)
 *
 * 記録は既存のカード API (`/api/progress/cards`) に `wordId` を送るだけ。
 * 進捗画面・ストリークは今の仕組みがそのまま効く (#76 / #67)。
 */

type Mode = "sound" | "initial" | "family";
type Stage = "intro" | "playing" | "done";

type Question = {
  /** 選ばせる語 (文字 or family の語) の ID */
  answerId: string;
  /** 選択肢 */
  choices: PhonicsWord[];
  /** 出題時に見せる語 (代表語 / family の語)。音の問題では null */
  target: PhonicsWord | null;
  /** 出題時に鳴らす語 */
  audio: PhonicsWord;
  /** 見出し (family の "-at" など) */
  heading: string;
  /** 出題文 */
  prompt: string;
};

const MODES: Array<{ id: Mode; label: string; emoji: string; desc: string }> = [
  {
    id: "sound",
    label: "おとを きく",
    emoji: "👂",
    desc: "音を きいて、その 音の もじを えらぼう。",
  },
  {
    id: "initial",
    label: "さいしょの もじ",
    emoji: "🔤",
    desc: "ことばの さいしょの もじを えらぼう。",
  },
  {
    id: "family",
    label: "おなじ おと",
    emoji: "🧩",
    desc: "おわりが おなじ ことばを あつめよう。",
  },
];

const LETTERS: PhonicsWord[] =
  categories.find((category) => category.id === "phonics")?.words ?? [];
const EXAMPLE_WORDS: PhonicsWord[] =
  categories.find((category) => category.id === "phonics-words")?.words ?? [];
const FAMILY_CATEGORIES = categories.filter((category) =>
  category.id.startsWith("word-family-"),
);
const FAMILY_WORDS: PhonicsWord[] = FAMILY_CATEGORIES.flatMap(
  (category) => category.words,
);

/** 文字の音を鳴らす。フォールバック (端末 TTS) でも文字名ではなく音を読ませる */
function speak(word: PhonicsWord) {
  void playWordAudio({ id: word.id, en: word.tts ?? word.en, audio: word.audio });
}

function buildQuestions(mode: Mode): Question[] {
  if (mode === "sound") {
    return pickRound(LETTERS).map((letter) => ({
      answerId: letter.id,
      choices: letterChoices(letter, LETTERS),
      target: null,
      audio: letter,
      heading: "？",
      prompt: "おとを きいて、もじを えらぼう。",
    }));
  }

  if (mode === "initial") {
    return pickRound(EXAMPLE_WORDS)
      .map((word): Question | null => {
        const letter = LETTERS.find(
          (candidate) => candidate.en.toLowerCase() === initialOf(word.en),
        );
        /* 頭文字の文字データが無い語は出題しない (データの追加時に落ちないように) */
        if (!letter) return null;
        return {
          answerId: letter.id,
          choices: initialChoices(letter, word, LETTERS),
          target: word,
          audio: word,
          heading: "？",
          prompt: "さいしょの もじは どれ?",
        };
      })
      .filter((question): question is Question => question !== null);
  }

  return pickRound(FAMILY_WORDS).map((word) => {
    const family = categoryOfFamily(word);
    return {
      answerId: word.id,
      choices: familyChoices(word, FAMILY_WORDS),
      target: null,
      audio: word,
      heading: `-${family}`,
      prompt: `おわりが 「-${family}」の ことばは どれ?`,
    };
  });
}

/** `word-family-op/cat` → `op` (純粋関数は `phonics.ts` 側にある) */
function categoryOfFamily(word: PhonicsWord): string {
  return familySuffix(word.id.split("/")[0] ?? "");
}

export default function PhonicsPanel() {
  const [mode, setMode] = useState<Mode>("sound");
  const [stage, setStage] = useState<Stage>("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  /** 1 回の練習で同じ語を何度も記録しない */
  const recordedRef = useRef<Set<string>>(new Set());

  const question = questions[index];
  const answered = picked !== null;
  const isCorrect = answered && picked === question?.answerId;

  useEffect(() => stopWordAudio, []);

  function recordView(wordId: string) {
    if (recordedRef.current.has(wordId)) return;
    recordedRef.current.add(wordId);
    void fetch("/api/progress/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventId: newClientId(), wordId }),
    }).catch(() => {
      recordedRef.current.delete(wordId);
    });
  }

  function start(nextMode: Mode = mode) {
    stopWordAudio();
    recordedRef.current = new Set();
    const built = buildQuestions(nextMode);
    setMode(nextMode);
    setQuestions(built);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setStage("playing");
    /* 最初の 1 問は「はじめる」のタップの中で鳴らす (自動再生ブロックを避ける) */
    const first = built[0];
    if (first) speak(first.audio);
  }

  function choose(choiceId: string) {
    if (!question || answered) return;
    setPicked(choiceId);
    if (choiceId === question.answerId) setCorrect((current) => current + 1);
    recordView(question.answerId);
    /* 代表語を見せた問題では、その語も「見た」として数える */
    if (question.target) recordView(question.target.id);
  }

  function next() {
    if (!question) return;
    if (index + 1 < questions.length) {
      const nextQuestion = questions[index + 1];
      setIndex(index + 1);
      setPicked(null);
      speak(nextQuestion.audio);
      return;
    }
    setStage("done");
  }

  const progressLabel = `${Math.min(index + 1, questions.length)} / ${questions.length}`;
  const choices = useMemo(() => question?.choices ?? [], [question]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        <Link
          href="/"
          className="rounded-full px-2 py-1.5 text-sm font-extrabold whitespace-nowrap text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink sm:px-3"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold whitespace-nowrap text-ink sm:text-lg">
          フォニックス
        </h1>
        <MuteToggle />
      </header>

      {stage === "intro" && (
        <section className="flex flex-1 flex-col justify-center rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
          <p className="text-5xl" aria-hidden>
            🔤
          </p>
          <h2 className="mt-3 text-2xl font-extrabold text-ink">
            もじと おとの おともだち
          </h2>
          <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
            えいごの もじには、それぞれ おとが あるよ。
            <br />
            おとを きいて、もじを さがしてみよう。
          </p>

          <div className="mt-5 grid gap-2">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                aria-pressed={mode === item.id}
                data-testid={`phonics-mode-${item.id}`}
                className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition ${
                  mode === item.id
                    ? "border-[#f4801f] bg-[#fff6e3]"
                    : "border-[#f0d59a] bg-[#fff8ec] hover:-translate-y-0.5"
                }`}
              >
                <span aria-hidden className="text-2xl">
                  {item.emoji}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-extrabold text-[#5b4a3c]">
                    {item.label}
                  </span>
                  <span className="text-xs font-bold text-[#8f7a5e]">{item.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => start()}
            data-testid="phonics-start"
            className="mx-auto mt-6 min-h-12 rounded-full bg-[#f4801f] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          >
            はじめる
          </button>
          <p className="mt-3 text-xs font-bold text-[#8f7a5e]">
            {PHONICS_ROUND_SIZE} もん
          </p>
        </section>
      )}

      {stage === "playing" && question && (
        <>
          <div className="flex items-center justify-center gap-2">
            <span className="rounded-full bg-badge px-3 py-1.5 text-xs font-extrabold text-white shadow-[0_3px_0_rgba(61,50,41,0.28)]">
              {MODES.find((item) => item.id === mode)?.label}
            </span>
            <span
              data-testid="phonics-progress"
              className="rounded-full border-2 border-white bg-white px-3 py-1.5 text-xs font-extrabold text-[#8f7a5e]"
            >
              {progressLabel}
            </span>
          </div>

          <section className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
            <p className="text-sm font-extrabold text-[#5b4a3c]">{question.prompt}</p>

            {/* 出題するもの: 音 (sound) / 代表語 (initial) / family の見出し (family) */}
            {question.target ? (
              <div className="flex flex-col items-center">
                <div className="text-6xl" aria-hidden>
                  {question.target.emoji}
                </div>
                <p className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
                  {question.target.en}
                </p>
                <p className="mt-1 text-xs font-bold text-[#8f7a5e]">
                  {question.target.ja}
                </p>
              </div>
            ) : (
              <p className="font-display text-5xl font-extrabold text-ink">
                {question.heading}
              </p>
            )}

            <button
              type="button"
              onClick={() => speak(question.audio)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#4dc9f6] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_rgba(26,111,149,0.35)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
            >
              <span aria-hidden>🔊</span>
              もう いちど きく
            </button>

            <div className="mt-2 grid w-full grid-cols-2 gap-3">
              {choices.map((choice) => {
                const chosen = picked === choice.id;
                const right = choice.id === question.answerId;
                const look = !answered
                  ? "border-[#f0d59a] bg-[#fff8ec] hover:-translate-y-0.5"
                  : right
                    ? "border-[#6cc24a] bg-[#eef7e2]"
                    : chosen
                      ? "border-[#ff6b6b] bg-[#ffeaf1]"
                      : "border-[#e8dccb] bg-white opacity-60";
                return (
                  <button
                    key={choice.id}
                    type="button"
                    data-testid="phonics-choice"
                    onClick={() => choose(choice.id)}
                    disabled={answered}
                    className={`flex min-h-16 flex-col items-center justify-center rounded-2xl border-2 px-3 py-3 transition ${look}`}
                  >
                    {mode === "family" ? (
                      <>
                        <span aria-hidden className="text-2xl">
                          {choice.emoji}
                        </span>
                        <span className="font-display text-xl font-extrabold text-ink">
                          {choice.en}
                        </span>
                      </>
                    ) : (
                      <span className="font-display text-4xl font-extrabold text-ink">
                        {choice.en}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="mt-1 flex flex-col items-center gap-2">
                <p
                  className={`text-base font-extrabold ${
                    isCorrect ? "text-[#38702f]" : "text-[#b03a63]"
                  }`}
                >
                  {isCorrect
                    ? "せいかい! 🎉"
                    : `おしい! こたえは ${
                        choices.find((choice) => choice.id === question.answerId)?.en ??
                        ""
                      }`}
                </p>
                <button
                  type="button"
                  onClick={next}
                  data-testid="phonics-next"
                  className="min-h-12 rounded-full bg-[#f4801f] px-7 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  {index + 1 < questions.length ? "つぎへ" : "おわり"}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {stage === "done" && (
        <section className="flex flex-1 flex-col items-center justify-center rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
          <p className="text-5xl" aria-hidden>
            🌟
          </p>
          <h2 className="mt-3 text-2xl font-extrabold text-ink">
            {correct} / {questions.length} もん せいかい
          </h2>
          <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
            もじの おとが、すこし わかるように なったよ。
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => start()}
              className="min-h-12 rounded-full bg-[#f4801f] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
            >
              もう いちど
            </button>
            <button
              type="button"
              onClick={() => setStage("intro")}
              className="min-h-11 rounded-full px-5 py-2 text-sm font-extrabold text-[#5b4a3c] underline decoration-[#c9b9a6] decoration-2 underline-offset-4 transition hover:bg-white"
            >
              モードを えらぶ
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
