"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { judgeAnswer, tasks, type Judgment, type Task } from "@/lib/sentences";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------------- *
 * 1問ぶんのカード
 * ---------------------------------------------------------------- */

function TaskCard({
  task,
  number,
  total,
  onNext,
}: {
  task: Task;
  number: number;
  total: number;
  onNext: () => void;
}) {
  // カードの並びはタスクごとに1回だけシャッフルする
  const cardOrder = useMemo(
    () => shuffle(task.words.map((_, i) => i)),
    [task],
  );

  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<Judgment | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const solved = result?.verdict === "correct";
  const remaining = cardOrder.filter((i) => !placed.includes(i));

  function place(i: number) {
    if (solved) return;
    setResult(null);
    setPlaced((p) => [...p, i]);
  }

  function unplace(i: number) {
    if (solved) return;
    setResult(null);
    setPlaced((p) => p.filter((x) => x !== i));
  }

  function clearAll() {
    if (solved) return;
    setResult(null);
    setPlaced([]);
  }

  function submit() {
    if (placed.length === 0 || solved) return;
    const answer = placed.map((i) => task.words[i]);
    const judgment = judgeAnswer(task, answer);
    setResult(judgment);
    if (judgment.verdict !== "correct") setAttempts((a) => a + 1);
  }

  return (
    <div className="flex flex-col">
      {/* 進捗 */}
      <div className="flex items-center justify-between text-sm">
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-[#5b4a3c] shadow-[0_3px_0_rgba(122,104,87,0.12)]">
          {number} / {total}
        </span>
        <button
          onClick={() => setShowHint((s) => !s)}
          className="min-h-10 rounded-full bg-[#fff3d6] px-4 py-2 text-xs font-extrabold text-[#a85f08] shadow-[0_3px_0_rgba(224,178,28,0.35)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
        >
          {showHint ? "ヒントをとじる" : "💡 ヒント"}
        </button>
      </div>

      {/* 相手の発言 */}
      <div className="mt-3 flex items-start gap-3 rounded-[26px] border-4 border-white bg-white/85 p-4 shadow-[0_8px_22px_rgba(122,104,87,0.14)]">
        <div className="text-4xl leading-none">{task.emoji}</div>
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-[#7a6857]">
            {task.speaker} <span className="ml-1">{task.scene}</span>
          </p>
          <p className="mt-1 text-lg leading-snug font-extrabold text-ink">
            “{task.prompt}”
          </p>
          {showHint && (
            <p className="mt-2 text-sm font-bold text-[#a85f08]">
              {task.promptJa}
              <span className="mt-1 block text-xs font-bold text-[#7a6857]">
                {task.hintJa}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* こたえの組み立てエリア */}
      <div
        className={`mt-4 min-h-24 rounded-[26px] border-[3px] border-dashed p-3 transition ${
          solved
            ? "border-[#8fd06a] bg-[#eef7e2]"
            : result
              ? "border-[#e0b21c] bg-[#fff8e2]"
              : "border-[#d8c6ab] bg-white/80"
        }`}
      >
        {placed.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm font-bold text-[#8b7a67]">
            したの カードを おして、ことばを ならべよう
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {placed.map((i, pos) => (
              <button
                key={`${i}-${pos}`}
                onClick={() => unplace(i)}
                disabled={solved}
                className={`min-h-11 rounded-2xl px-4 py-2 text-base font-extrabold shadow-[0_3px_0_rgba(61,50,41,0.22)] transition ${
                  solved
                    ? "bg-[#6cc24a] text-white"
                    : "bg-badge text-white hover:-translate-y-0.5 hover:bg-[#75492e]"
                }`}
              >
                {task.words[i]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* フィードバック */}
      <div aria-live="polite" className="min-h-12">
        {result?.verdict === "correct" && (
          <div className="mt-3 rounded-[22px] border-4 border-white bg-[#eef7e2] p-4 text-center shadow-[0_6px_16px_rgba(122,104,87,0.12)]">
            <p className="text-xl font-extrabold text-[#38702f]">✅ せいかい！</p>
            <p className="mt-2 text-base font-bold text-ink">
              {task.replyEmoji} {task.speaker}: “{task.reply}”
            </p>
            {attempts === 0 && (
              <p className="mt-1 text-sm font-extrabold text-[#38702f]">
                ⭐ ノーミス！
              </p>
            )}
          </div>
        )}
        {result?.verdict === "grammar" && (
          <p className="mt-3 rounded-[22px] bg-[#fff8e2] p-3 text-center text-sm font-extrabold text-[#8a5a12]">
            📝 {result.detail ?? "ぶんぽうを たしかめてみよう"}
          </p>
        )}
        {result?.verdict === "wrong-order" && (
          <p className="mt-3 rounded-[22px] bg-[#fff8e2] p-3 text-center text-sm font-extrabold text-[#8a5a12]">
            🤔 ことばは あってるよ！じゅんばんを かんがえてみよう
          </p>
        )}
        {result?.verdict === "wrong-words" && (
          <p className="mt-3 rounded-[22px] bg-[#fff8e2] p-3 text-center text-sm font-extrabold text-[#8a5a12]">
            🤔 おしい！つかう ことばを えらびなおしてみよう
          </p>
        )}
      </div>

      {/* 単語カード */}
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {remaining.map((i) => (
          <button
            key={i}
            onClick={() => place(i)}
            disabled={solved}
            className="min-h-11 rounded-2xl border-2 border-white bg-[#fff6e3] px-4 py-2 text-base font-extrabold text-ink shadow-[0_4px_0_rgba(122,104,87,0.16)] transition hover:-translate-y-0.5 hover:bg-white active:translate-y-0.5 active:shadow-none disabled:opacity-40"
          >
            {task.words[i]}
          </button>
        ))}
      </div>

      {/* 操作 */}
      <div className="mt-5 flex items-center justify-center gap-3">
        {solved ? (
          <button
            onClick={onNext}
            className="min-h-12 rounded-full bg-[#6cc24a] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#4a9b2f] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          >
            つぎへ →
          </button>
        ) : (
          <>
            <button
              onClick={clearAll}
              className="min-h-12 rounded-full border-2 border-[#e0cdb0] bg-white px-5 py-3 text-sm font-extrabold text-[#5b4a3c] transition hover:-translate-y-0.5 hover:bg-[#fff6e3]"
            >
              やりなおす
            </button>
            <button
              onClick={submit}
              disabled={placed.length === 0}
              className="min-h-12 rounded-full bg-[#f4801f] px-8 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:bg-[#cdbba2] disabled:text-[#f6ecdc] disabled:shadow-[0_4px_0_#b8a68d]"
            >
              できた！
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * ゲーム本体
 * ---------------------------------------------------------------- */

export default function WordOrderingPage() {
  const [deck, setDeck] = useState<Task[]>(() => shuffle(tasks));
  const [index, setIndex] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [finished, setFinished] = useState(false);

  const total = deck.length;
  const task = deck[index];

  function handleNext() {
    setCleared((c) => c + 1);
    if (index + 1 >= total) {
      setFinished(true);
    } else {
      setIndex((i) => i + 1);
    }
  }

  function restart() {
    setDeck(shuffle(tasks));
    setIndex(0);
    setCleared(0);
    setFinished(false);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold text-ink sm:text-lg">
          単語ならべかえ
        </h1>
        <span className="rounded-full bg-[#fff3d6] px-3 py-1.5 text-xs font-extrabold text-[#a85f08]">
          ⭐ {cleared}
        </span>
      </header>

      <div className="mt-6 flex-1">
        {finished ? (
          <div className="flex flex-col items-center rounded-[32px] border-4 border-white bg-white/85 px-6 py-12 text-center shadow-[0_12px_30px_rgba(122,104,87,0.16)]">
            <p className="text-5xl">🎊</p>
            <h2 className="mt-4 text-2xl font-extrabold text-ink">
              ぜんぶ できた！
            </h2>
            <p className="mt-2 text-lg font-bold text-[#5b4a3c]">
              ⭐ {cleared} / {total} 問 クリア
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={restart}
                className="min-h-12 rounded-full bg-[#f4801f] px-7 py-3 text-base font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
              >
                もういちど
              </button>
              <Link
                href="/"
                className="min-h-12 rounded-full border-2 border-[#e0cdb0] bg-white px-7 py-3 text-base font-extrabold text-[#5b4a3c] transition hover:-translate-y-0.5 hover:bg-[#fff6e3]"
              >
                ホームへ
              </Link>
            </div>
          </div>
        ) : (
          <TaskCard
            key={task.id}
            task={task}
            number={index + 1}
            total={total}
            onNext={handleNext}
          />
        )}
      </div>
    </main>
  );
}
