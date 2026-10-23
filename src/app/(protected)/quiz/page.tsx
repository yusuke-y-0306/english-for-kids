"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import {
  buildRound,
  quizLevels,
  starsFor,
  type QuizLevel,
  type QuizLevelId,
  type QuizQuestion,
} from "@/lib/quiz";

/* ------------------------------------------------------------------ *
 * ベストスコア（localStorage）
 * ------------------------------------------------------------------ */

const BEST_KEY = "kodomo-eigo-quiz-best-v1";
const MUTE_KEY = "kodomo-eigo-quiz-mute-v1";
const STORE_EVENT = "kodomo-eigo-quiz-store";

type BestScores = Partial<Record<QuizLevelId, number>>;

type QuizStore = { best: BestScores; muted: boolean };

const EMPTY_STORE: QuizStore = { best: {}, muted: false };

/*
 * localStorage は「外部ストア」として useSyncExternalStore で読む。
 * effect の中で setState すると cascading render になるため。
 */
let storeCache: QuizStore = EMPTY_STORE;
let storeLoaded = false;

function readStore(): QuizStore {
  if (!storeLoaded && typeof window !== "undefined") {
    try {
      const rawBest = window.localStorage.getItem(BEST_KEY);
      storeCache = {
        best: rawBest ? (JSON.parse(rawBest) as BestScores) : {},
        muted: window.localStorage.getItem(MUTE_KEY) === "1",
      };
    } catch {
      storeCache = EMPTY_STORE;
    }
    storeLoaded = true;
  }
  return storeCache;
}

function writeStore(next: QuizStore) {
  storeCache = next;
  storeLoaded = true;
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(next.best));
    window.localStorage.setItem(MUTE_KEY, next.muted ? "1" : "0");
  } catch {
    /* 保存できなくても プレイは続けられる */
  }
  window.dispatchEvent(new Event(STORE_EVENT));
}

function subscribeStore(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}

type Screen = "title" | "playing" | "result";

/* ------------------------------------------------------------------ *
 * おと（Web Audio。音声ファイルなしで軽く鳴らす）
 * ------------------------------------------------------------------ */

const CONFETTI_COLORS = [
  "#ff6b6b",
  "#ffd93d",
  "#6cc24a",
  "#4dc9f6",
  "#a17bf0",
  "#ff9f43",
];

function makePieces() {
  return Array.from({ length: 26 }, (_, i) => ({
    left: 6 + Math.random() * 88,
    dx: (Math.random() - 0.5) * 180,
    rot: 200 + Math.random() * 560,
    delay: Math.random() * 0.28,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 8 + Math.random() * 9,
    round: Math.random() > 0.55,
  }));
}

/* 描画中に乱数を振らないよう、バリエーションはモジュール読み込み時に作る */
const CONFETTI_VARIANTS = [makePieces(), makePieces(), makePieces()];

function Confetti({ burstKey }: { burstKey: number }) {
  const pieces = CONFETTI_VARIANTS[burstKey % CONFETTI_VARIANTS.length];

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="anim-confetti absolute top-[22%] block opacity-0"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.55,
              backgroundColor: p.color,
              borderRadius: p.round ? "9999px" : "3px",
              animationDelay: `${p.delay}s`,
              "--dx": `${p.dx}px`,
              "--rot": `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * クイズ本体
 * ------------------------------------------------------------------ */

export default function QuizPage() {
  const [screen, setScreen] = useState<Screen>("title");
  const [level, setLevel] = useState<QuizLevel>(quizLevels[0]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastGain, setLastGain] = useState(0);
  const [newRecord, setNewRecord] = useState(false);
  const [burst, setBurst] = useState(0);
  const [shake, setShake] = useState(0);

  const store = useSyncExternalStore(subscribeStore, readStore, () => EMPTY_STORE);
  const best = store.best;
  const muted = store.muted;

  const audioRef = useRef<AudioContext | null>(null);

  /* --- 紙ふぶきは 1.6 秒で片づける --- */
  useEffect(() => {
    if (burst === 0) return;
    const timer = window.setTimeout(() => setBurst(0), 1600);
    return () => window.clearTimeout(timer);
  }, [burst]);

  /* --- おと --- */
  function tone(
    freq: number,
    startAt: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ) {
    if (muted) return;
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) return;
    if (!audioRef.current) audioRef.current = new AudioCtor();
    const ctx = audioRef.current;
    if (ctx.state === "suspended") void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + startAt;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function playCorrect() {
    tone(659.25, 0, 0.18, "triangle", 0.07);
    tone(830.61, 0.09, 0.18, "triangle", 0.07);
    tone(987.77, 0.18, 0.26, "triangle", 0.06);
  }

  function playWrong() {
    tone(311.13, 0, 0.18, "sine", 0.06);
    tone(246.94, 0.14, 0.28, "sine", 0.06);
  }

  function playFinish() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, i * 0.11, 0.3, "triangle", 0.06),
    );
  }

  /* --- 進行 --- */
  const total = questions.length;
  const question = questions[index];
  const answered = selected !== null;
  const isCorrect = answered && selected === question?.answer;

  function start(l: QuizLevel) {
    setLevel(l);
    setQuestions(buildRound(l.id));
    setIndex(0);
    setSelected(null);
    setScore(0);
    setCorrectCount(0);
    setStreak(0);
    setLastGain(0);
    setNewRecord(false);
    setShake(0);
    setScreen("playing");
  }

  function answer(choice: number) {
    if (selected !== null || !question) return;

    setSelected(choice);

    if (choice === question.answer) {
      const nextStreak = streak + 1;
      const gain = nextStreak >= 3 ? 15 : 10;
      setStreak(nextStreak);
      setScore((s) => s + gain);
      setCorrectCount((c) => c + 1);
      setLastGain(gain);
      setBurst(Date.now());
      playCorrect();
    } else {
      setStreak(0);
      setLastGain(0);
      setShake((n) => n + 1);
      playWrong();
    }
  }

  function next() {
    if (selected === null) return;

    if (index + 1 >= total) {
      const isRecord = score > (best[level.id] ?? 0) && score > 0;
      if (isRecord) {
        writeStore({ best: { ...best, [level.id]: score }, muted });
      }
      setNewRecord(isRecord);
      setScreen("result");
      playFinish();
      if (correctCount >= Math.ceil(total * 0.7)) setBurst(Date.now());
      return;
    }

    setIndex((i) => i + 1);
    setSelected(null);
    setShake(0);
  }

  /* --- キーボード操作（1〜4で回答、Enterで次へ） --- */
  const answerRef = useRef(answer);
  const nextRef = useRef(next);
  useEffect(() => {
    answerRef.current = answer;
    nextRef.current = next;
  });

  useEffect(() => {
    if (screen !== "playing") return;
    const onKey = (event: KeyboardEvent) => {
      if (/^[1-4]$/.test(event.key)) {
        const i = Number(event.key) - 1;
        if (i < question.choices.length) answerRef.current(i);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        nextRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, question]);

  function toggleMute() {
    writeStore({ best, muted: !muted });
  }

  const stars = starsFor(correctCount, total);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      {burst > 0 && <Confetti burstKey={burst} />}

      {/* ヘッダー */}
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        {screen === "playing" ? (
          <button
            onClick={() => setScreen("title")}
            className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
          >
            ← レベル
          </button>
        ) : (
          <Link
            href="/"
            className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
          >
            ← ホーム
          </Link>
        )}

        <h1 className="text-base font-extrabold text-ink sm:text-lg">
          {screen === "title" ? "クイズ・ゲーム" : `${level.emoji} ${level.label}`}
        </h1>

        <div className="flex items-center gap-1.5">
          {screen === "playing" && (
            <span className="rounded-full bg-[#fff3d6] px-3 py-1.5 text-xs font-extrabold text-[#a85f08]">
              ⭐ {score}
            </span>
          )}
          <button
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "おとを だす" : "おとを けす"}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-base shadow-[0_2px_0_rgba(122,104,87,0.16)] transition hover:-translate-y-0.5"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------------- *
       * タイトル（レベルえらび）
       * ---------------------------------------------------------------- */}
      {screen === "title" && (
        <div className="mt-6">
          <div className="anim-pop rounded-[32px] border-4 border-white bg-white/85 px-5 py-8 text-center shadow-[0_12px_30px_rgba(122,104,87,0.14)]">
            <div className="anim-bob text-6xl leading-none">🎮</div>
            <h2 className="mt-4 text-[1.7rem] leading-tight font-extrabold text-ink sm:text-3xl">
              4たくクイズに
              <br className="sm:hidden" />
              ちょうせん！
            </h2>
            <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c] sm:text-base">
              1ラウンド 8もん。せいかいで 10てん、
              <br className="sm:hidden" />
              3もん れんぞくで ボーナス +5てん！
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#fff3d6] px-4 py-2 text-xs font-extrabold text-[#a85f08]">
              ⌨️ キーボードの 1〜4 でも こたえられるよ
            </p>
          </div>

          <ul className="mt-5 flex flex-col gap-3">
            {quizLevels.map((l, i) => (
              <li
                key={l.id}
                className="anim-pop"
                style={{ animationDelay: `${120 + i * 80}ms` }}
              >
                <button
                  onClick={() => start(l)}
                  style={{ backgroundColor: l.color }}
                  className="group flex w-full items-center gap-4 rounded-[26px] border-4 border-white p-4 text-left shadow-[0_8px_20px_rgba(122,104,87,0.14)] transition hover:-translate-y-1 hover:shadow-[0_16px_30px_rgba(122,104,87,0.2)] active:translate-y-0.5 sm:p-5"
                >
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-[0_3px_0_rgba(61,50,41,0.12)]">
                    {l.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-extrabold text-ink">
                      {l.label}
                    </span>
                    <span
                      className="block font-display text-[0.64rem] font-semibold tracking-[0.16em] uppercase"
                      style={{ color: l.ink }}
                    >
                      {l.en}
                    </span>
                    <span className="mt-1 block text-sm font-bold text-[#5b4a3c]">
                      {l.desc}
                    </span>
                    <span className="mt-1 block text-[0.7rem] font-extrabold text-[#7a6857]">
                      {best[l.id]
                        ? `🏅 ベスト ${best[l.id]} てん`
                        : "まだ あそんだことがない"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-xl transition group-hover:translate-x-1"
                    style={{ color: l.ink }}
                  >
                    ▶
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------------------------------------------------------- *
       * プレイ中
       * ---------------------------------------------------------------- */}
      {screen === "playing" && question && (
        <div className="mt-4 flex flex-1 flex-col">
          {/* 進捗 */}
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/80 shadow-[inset_0_1px_2px_rgba(122,104,87,0.18)]">
              <div
                className="h-full rounded-full bg-[#6cc24a] transition-[width] duration-300 ease-out"
                style={{
                  width: `${((index + (answered ? 1 : 0)) / total) * 100}%`,
                }}
              />
            </div>
            <span className="shrink-0 text-xs font-extrabold text-[#5b4a3c]">
              {index + 1} / {total}
            </span>
          </div>

          {streak >= 2 && (
            <p className="mt-2 text-center text-xs font-extrabold text-[#e2661a]">
              🔥 {streak} れんぞく せいかいちゅう！
            </p>
          )}

          {/* 問題 */}
          <div
            key={question.id}
            className="anim-pop mt-3 rounded-[30px] border-4 border-white bg-white/90 px-5 py-7 text-center shadow-[0_10px_26px_rgba(122,104,87,0.16)]"
          >
            {question.display && (
              <div className="text-6xl leading-none">{question.display}</div>
            )}
            {question.promptEn && (
              <p className="font-display text-[1.45rem] leading-snug font-semibold text-ink sm:text-3xl">
                {question.promptEn}
              </p>
            )}
            <p
              className={
                question.promptEn
                  ? "mt-2 text-sm font-extrabold text-[#7a6857]"
                  : "mt-4 text-xl font-extrabold text-ink sm:text-2xl"
              }
            >
              {question.promptJa}
            </p>
          </div>

          {/* 選択肢 */}
          <div
            key={`choices-${question.id}-${shake}`}
            className={`mt-4 grid gap-2.5 ${
              level.id === "beginner" ? "grid-cols-2" : "grid-cols-1"
            } ${shake > 0 && !isCorrect ? "anim-shake" : ""}`}
          >
            {question.choices.map((choice, i) => {
              const showAnswer = answered && i === question.answer;
              const showWrong = answered && i === selected && i !== question.answer;

              let look =
                "border-white bg-white text-ink shadow-[0_4px_0_rgba(122,104,87,0.16)] hover:-translate-y-0.5 hover:shadow-[0_6px_0_rgba(122,104,87,0.16)] active:translate-y-0.5 active:shadow-none";
              if (showAnswer) {
                look =
                  "border-[#6cc24a] bg-[#eef7e2] text-[#2f6b2a] shadow-[0_4px_0_#a5d98a]";
              } else if (showWrong) {
                look =
                  "border-[#ff8fb0] bg-[#ffecec] text-[#b03a63] shadow-[0_4px_0_#ffc2d2]";
              } else if (answered) {
                look = "border-white bg-white/55 text-[#8b7a67] opacity-60";
              }

              return (
                <button
                  key={`${choice}-${i}`}
                  onClick={() => answer(i)}
                  disabled={answered}
                  className={`flex min-h-14 items-center gap-2.5 rounded-2xl border-[3px] px-3.5 py-3 text-left font-extrabold transition ${look} ${
                    level.id === "beginner" ? "text-lg" : "text-[0.95rem] leading-snug"
                  } ${answered ? "cursor-default" : ""}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#fff3d6] text-[0.68rem] text-[#a85f08]">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{choice}</span>
                  {showAnswer && <span aria-hidden>⭕</span>}
                  {showWrong && <span aria-hidden>❌</span>}
                </button>
              );
            })}
          </div>

          {/* フィードバック */}
          <div aria-live="polite" className="mt-4">
            {answered &&
              (isCorrect ? (
                <div className="anim-correct-pop rounded-[24px] border-4 border-white bg-[#eef7e2] p-4 text-center shadow-[0_6px_16px_rgba(122,104,87,0.12)]">
                  <p className="text-xl font-extrabold text-[#38702f]">
                    ⭕ せいかい！{" "}
                    <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-base">
                      +{lastGain} てん
                    </span>
                  </p>
                  {lastGain === 15 && (
                    <p className="mt-1 text-xs font-extrabold text-[#e2661a]">
                      🔥 れんぞくボーナス！
                    </p>
                  )}
                  <p className="mt-2 text-sm leading-relaxed font-bold text-[#5b4a3c]">
                    {question.explanation}
                  </p>
                </div>
              ) : (
                <div className="anim-correct-pop rounded-[24px] border-4 border-white bg-[#fff8e2] p-4 text-center shadow-[0_6px_16px_rgba(122,104,87,0.12)]">
                  <p className="text-lg font-extrabold text-[#8a5a12]">
                    おしい！ こたえは “{question.choices[question.answer]}”
                  </p>
                  <p className="mt-2 text-sm leading-relaxed font-bold text-[#5b4a3c]">
                    {question.explanation}
                  </p>
                </div>
              ))}
          </div>

          {/* つぎへ */}
          <div className="mt-auto pt-5">
            <button
              onClick={next}
              disabled={!answered}
              className="min-h-13 w-full rounded-full bg-[#f4801f] px-8 py-3.5 text-base font-extrabold text-white shadow-[0_5px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_#c25f0d] disabled:cursor-not-allowed disabled:bg-[#c3b09a] disabled:text-white disabled:shadow-[0_4px_0_#a89579] disabled:hover:translate-y-0"
            >
              {index + 1 >= total ? "けっかを みる 🎉" : "つぎの もんだい →"}
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- *
       * 結果
       * ---------------------------------------------------------------- */}
      {screen === "result" && (
        <div className="mt-6">
          <div className="anim-pop rounded-[32px] border-4 border-white bg-white/90 px-6 py-9 text-center shadow-[0_12px_30px_rgba(122,104,87,0.16)]">
            <p className="text-6xl leading-none">
              {stars === 3 ? "🏆" : stars === 2 ? "🎉" : stars === 1 ? "😊" : "🌱"}
            </p>
            <h2 className="mt-4 text-2xl font-extrabold text-ink">
              {stars === 3
                ? "パーフェクト！"
                : stars === 2
                  ? "すごい！"
                  : stars === 1
                    ? "よく がんばった！"
                    : "つぎは できるよ！"}
            </h2>

            <p className="mt-3 text-4xl font-extrabold text-[#f4801f]">
              {score}
              <span className="ml-1 text-base text-[#5b4a3c]">てん</span>
            </p>
            <p className="mt-1 text-sm font-bold text-[#5b4a3c]">
              ⭕ {correctCount} / {total} もん せいかい
            </p>

            <div className="mt-4 flex items-center justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`anim-star-pop text-4xl ${
                    i < stars ? "" : "opacity-40 grayscale"
                  }`}
                  style={{ animationDelay: `${i * 140}ms` }}
                >
                  ⭐
                </span>
              ))}
            </div>

            {newRecord ? (
              <p className="mt-4 inline-block rounded-full bg-[#fff3d6] px-4 py-2 text-sm font-extrabold text-[#a85f08]">
                🏅 ベスト こうしん！
              </p>
            ) : (
              <p className="mt-4 text-xs font-extrabold text-[#7a6857]">
                ベスト: {best[level.id] ?? 0} てん
              </p>
            )}

            <div className="mt-7 flex flex-col gap-3">
              <button
                onClick={() => start(level)}
                className="min-h-12 rounded-full bg-[#6cc24a] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#4a9b2f] transition hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_#4a9b2f]"
              >
                もういちど
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setScreen("title")}
                  className="min-h-12 flex-1 rounded-full border-2 border-[#e0cdb0] bg-white px-4 py-3 text-sm font-extrabold text-[#5b4a3c] transition hover:-translate-y-0.5 hover:bg-[#fff6e3]"
                >
                  レベルを えらぶ
                </button>
                <Link
                  href="/"
                  className="flex min-h-12 flex-1 items-center justify-center rounded-full border-2 border-[#e0cdb0] bg-white px-4 py-3 text-sm font-extrabold text-[#5b4a3c] transition hover:-translate-y-0.5 hover:bg-[#fff6e3]"
                >
                  ホームへ
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
