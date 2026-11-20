"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MuteToggle } from "@/components/audio/MuteToggle";
import { SpeakButton } from "@/components/audio/SpeakButton";
import { playWordAudio, stopWordAudio } from "@/lib/audio/play";
import { newClientId } from "@/lib/client-id";
import { categories, type Word } from "@/lib/words";

/**
 * サイトワードの 3 ステップ練習 — issue #87
 *
 * 絵で描けない高頻度語 (the / and / is …) を
 *   ① みて よむ → ② きいて えらぶ → ③ ぶんで えらぶ
 * の順で、同じ 8 語を 3 回くり返す。
 *
 * 音声は生成済みの単語 mp3 (`/audio/words/sight-words/...`) を優先する。
 * 再生できない端末では `playWordAudio()` が端末 TTS にフォールバックする。
 */

const ROUND_SIZE = 8;

const SIGHT_WORDS: Word[] =
  categories.find((category) => category.id === "sight-words")?.words ?? [];

type Stage = "intro" | "read" | "listen" | "sentence" | "done";

const STAGE_LABEL: Record<Exclude<Stage, "intro" | "done">, string> = {
  read: "みて よむ",
  listen: "きいて えらぶ",
  sentence: "ぶんで えらぶ",
};

const STAGE_ORDER: Array<Exclude<Stage, "intro" | "done">> = [
  "read",
  "listen",
  "sentence",
];

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 例文の対象語を空欄にする。見つからなければそのまま返す (データの書き間違いで落とさない) */
function blankOut(sentence: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  return pattern.test(sentence) ? sentence.replace(pattern, "＿＿＿") : sentence;
}

/** 正解 1 つ + ダミー 3 つ。同じ綴りの語はダミーにしない */
function choicesFor(answer: Word, pool: readonly Word[]): Word[] {
  const distractors = shuffle(
    pool.filter((word) => word.id !== answer.id && word.en !== answer.en),
  ).slice(0, 3);
  return shuffle([answer, ...distractors]);
}

export default function SightWordsPanel() {
  const [stage, setStage] = useState<Stage>("intro");
  const [round, setRound] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState(0);
  /** 同じ単語を 1 回の練習で何度もカード閲覧として数えない */
  const recordedRef = useRef<Set<string>>(new Set());

  const word = round[index];
  const stageNumber = stage === "read" ? 0 : stage === "listen" ? 1 : 2;

  function recordView(id: string) {
    if (recordedRef.current.has(id)) return;
    recordedRef.current.add(id);
    void fetch("/api/progress/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventId: newClientId(), wordId: id }),
    }).catch(() => {
      recordedRef.current.delete(id);
    });
  }

  function start() {
    stopWordAudio();
    recordedRef.current = new Set();
    setRound(shuffle(SIGHT_WORDS).slice(0, ROUND_SIZE));
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setAnswered(0);
    setStage("read");
  }

  function nextWord() {
    if (!word) return;

    if (stage === "read") recordView(word.id);

    if (index + 1 < round.length) {
      const next = round[index + 1];
      setIndex(index + 1);
      setPicked(null);
      /* 聞き取りステージでは、次の語をボタン操作の中でそのまま鳴らす
         (useEffect から鳴らすと自動再生ブロックに遭う) */
      if (stage === "listen") playWordAudio(next);
      return;
    }

    if (stage === "read") {
      setStage("listen");
      setIndex(0);
      setPicked(null);
      playWordAudio(round[0]);
      return;
    }
    if (stage === "listen") {
      setStage("sentence");
      setIndex(0);
      setPicked(null);
      return;
    }
    setStage("done");
  }

  function choose(choice: Word) {
    if (picked !== null) return;
    setPicked(choice.id);
    setAnswered((current) => current + 1);
    if (choice.id === word.id) setCorrect((current) => current + 1);
  }

  /* 選択肢は語ごとに固定する。再描画のたびに並べ替えると、
     答えを選んだ瞬間にボタンの位置が動いてしまう */
  const choices = useMemo(
    () => (word ? choicesFor(word, SIGHT_WORDS) : []),
    [word],
  );
  const isCorrect = picked !== null && picked === word?.id;
  const example = word?.example;
  const prompt = example ? blankOut(example.en, word.en) : "";

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
          サイトワード
        </h1>
        <MuteToggle />
      </header>

      {stage === "intro" && (
        <section className="flex flex-1 flex-col justify-center rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
          <p className="text-5xl" aria-hidden>
            🔤
          </p>
          <h2 className="mt-3 text-2xl font-extrabold text-ink">よく でる ことばを おぼえよう</h2>
          <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
            the・and・is のような ことばは、絵では かきにくいけれど
            <br />
            えいごの 本の なかで たくさん でてくるよ。
          </p>
          <ol className="mx-auto mt-5 max-w-sm space-y-2 text-left">
            {STAGE_ORDER.map((item, i) => (
              <li
                key={item}
                className="flex items-center gap-3 rounded-2xl border-2 border-[#f0d59a] bg-[#fff8ec] px-3 py-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f4801f] text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <span className="text-sm font-extrabold text-[#5b4a3c]">
                  {STAGE_LABEL[item]}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={start}
            className="mx-auto mt-6 min-h-12 rounded-full bg-[#f4801f] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          >
            はじめる
          </button>
          <p className="mt-3 text-xs font-bold text-[#8f7a5e]">
            8 語 × 3 ステップ（{ROUND_SIZE * 2} もん の クイズ）
          </p>
        </section>
      )}

      {stage !== "intro" && stage !== "done" && word && (
        <>
          {/* ステップ表示 */}
          <div className="flex items-center justify-center gap-2">
            {STAGE_ORDER.map((item, i) => {
              const active = item === stage;
              const done = i < stageNumber;
              return (
                <span
                  key={item}
                  aria-current={active ? "step" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold ${
                    active
                      ? "bg-badge text-white shadow-[0_3px_0_rgba(61,50,41,0.28)]"
                      : done
                        ? "border-2 border-[#cde7bc] bg-[#eef7e2] text-[#38702f]"
                        : "border-2 border-white bg-white text-[#8f7a5e]"
                  }`}
                >
                  <span aria-hidden>{done ? "✓" : i + 1}</span>
                  {STAGE_LABEL[item]}
                </span>
              );
            })}
          </div>

          <section className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
            <p className="text-xs font-bold text-[#8f7a5e]">
              {index + 1} / {round.length}
            </p>

            {stage === "read" && (
              <>
                <div className="text-6xl" aria-hidden>
                  {word.emoji}
                </div>
                <p className="font-display text-5xl font-extrabold tracking-tight text-ink">
                  {word.en}
                </p>
                <p className="text-lg font-bold text-ink-soft">{word.ja}</p>
                <SpeakButton word={word} label="おとを きく" tone="primary" />
                {example && (
                  <div className="mt-1 w-full max-w-md rounded-2xl border-2 border-[#e7f2fb] bg-[#f4fbff] p-4 text-left">
                    <p className="font-display text-lg font-semibold text-[#1f5f8b]">
                      {example.en}
                    </p>
                    <p className="mt-1 text-sm font-bold text-[#5b4a3c]">{example.ja}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={nextWord}
                  className="mt-2 min-h-12 rounded-full bg-[#4dc9f6] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_rgba(26,111,149,0.35)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  よめた！
                </button>
              </>
            )}

            {stage === "listen" && (
              <>
                <p className="text-sm font-extrabold text-ink-soft">
                  おとを きいて、ことばを えらぼう
                </p>
                <p className="text-6xl" aria-hidden>
                  👂
                </p>
                <SpeakButton word={word} label="もういちど きく" tone="primary" />
                <div className="grid w-full max-w-md grid-cols-2 gap-3">
                  {choices.map((choice) => {
                    const chosen = picked === choice.id;
                    const right = picked !== null && choice.id === word.id;
                    const wrong = chosen && !right;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => choose(choice)}
                        disabled={picked !== null}
                        className={`min-h-14 rounded-2xl border-2 px-3 py-3 font-display text-xl font-bold transition ${
                          right
                            ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                            : wrong
                              ? "border-red-300 bg-red-50 text-red-700"
                              : "border-[#e2d3bd] bg-white text-ink hover:-translate-y-0.5 disabled:opacity-70"
                        }`}
                      >
                        {choice.en}
                      </button>
                    );
                  })}
                </div>
                {picked !== null && (
                  <p
                    role="status"
                    className={`text-base font-extrabold ${isCorrect ? "text-emerald-700" : "text-[#b03a63]"}`}
                  >
                    {isCorrect ? "せいかい！" : `おしい！ こたえは “${word.en}”`}
                  </p>
                )}
              </>
            )}

            {stage === "sentence" && example && (
              <>
                <p className="text-sm font-extrabold text-ink-soft">
                  ぶんに あう ことばを えらぼう
                </p>
                <p className="font-display text-3xl leading-snug font-semibold text-ink">
                  {prompt}
                </p>
                <p className="text-sm font-bold text-[#5b4a3c]">{example.ja}</p>
                <div className="grid w-full max-w-md grid-cols-2 gap-3">
                  {choices.map((choice) => {
                    const chosen = picked === choice.id;
                    const right = picked !== null && choice.id === word.id;
                    const wrong = chosen && !right;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => choose(choice)}
                        disabled={picked !== null}
                        className={`min-h-14 rounded-2xl border-2 px-3 py-3 font-display text-xl font-bold transition ${
                          right
                            ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                            : wrong
                              ? "border-red-300 bg-red-50 text-red-700"
                              : "border-[#e2d3bd] bg-white text-ink hover:-translate-y-0.5 disabled:opacity-70"
                        }`}
                      >
                        {choice.en}
                      </button>
                    );
                  })}
                </div>
                {picked !== null && (
                  <div role="status" className="space-y-1">
                    <p
                      className={`text-base font-extrabold ${isCorrect ? "text-emerald-700" : "text-[#b03a63]"}`}
                    >
                      {isCorrect ? "せいかい！" : `おしい！ こたえは “${word.en}”`}
                    </p>
                    <p className="font-display text-sm font-semibold text-[#1f5f8b]">
                      {example.en}
                    </p>
                  </div>
                )}
              </>
            )}

            {picked !== null && (
              <button
                type="button"
                onClick={nextWord}
                className="mt-1 min-h-12 rounded-full bg-[#4dc9f6] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_rgba(26,111,149,0.35)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
              >
                つぎへ →
              </button>
            )}
          </section>
        </>
      )}

      {stage === "done" && (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
          <p className="text-6xl" aria-hidden>
            🎉
          </p>
          <h2 className="text-2xl font-extrabold text-ink">おわり！</h2>
          <p className="text-base font-bold text-[#5b4a3c]">
            {ROUND_SIZE * 2} もん ちゅう <span className="text-2xl text-[#a85f08]">{correct}</span> もん せいかい
          </p>
          <p className="text-sm font-bold text-[#8f7a5e]">
            {correct === answered && answered > 0
              ? "ばっちり！ ことばの ほしを ゲットしたね。"
              : "まちがえても だいじょうぶ。もう いちど やってみよう。"}
          </p>
          <button
            type="button"
            onClick={start}
            className="mt-3 min-h-12 rounded-full bg-[#f4801f] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          >
            もう いちど
          </button>
          <Link
            href="/"
            className="text-sm font-extrabold text-[#5b4a3c] underline decoration-[#c9b9a6] decoration-2 underline-offset-4"
          >
            ホームへ もどる
          </Link>
        </section>
      )}
    </main>
  );
}
