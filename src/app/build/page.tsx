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
      <div className="flex items-center justify-between text-sm text-zinc-400">
        <span>
          {number} / {total}
        </span>
        <button
          onClick={() => setShowHint((s) => !s)}
          className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 transition hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
        >
          {showHint ? "ヒントをとじる" : "💡 ヒント"}
        </button>
      </div>

      {/* 相手の発言 */}
      <div className="mt-3 flex items-start gap-3 rounded-3xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-4xl leading-none">{task.emoji}</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {task.speaker} <span className="ml-1">{task.scene}</span>
          </p>
          <p className="mt-1 text-lg font-semibold leading-snug">
            “{task.prompt}”
          </p>
          {showHint && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              {task.promptJa}
              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                {task.hintJa}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* こたえの組み立てエリア */}
      <div
        className={`mt-4 min-h-24 rounded-3xl border-2 border-dashed p-3 transition ${
          solved
            ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
            : result
              ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-900/10"
              : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
        }`}
      >
        {placed.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-zinc-400">
            したの カードを おして、ことばを ならべよう
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {placed.map((i, pos) => (
              <button
                key={`${i}-${pos}`}
                onClick={() => unplace(i)}
                disabled={solved}
                className={`rounded-xl px-3 py-2 text-base font-semibold shadow-sm transition ${
                  solved
                    ? "bg-emerald-500 text-white"
                    : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
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
          <div className="mt-3 rounded-2xl bg-emerald-50 p-4 text-center dark:bg-emerald-900/20">
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
              ✅ せいかい！
            </p>
            <p className="mt-2 text-base">
              {task.replyEmoji} {task.speaker}: “{task.reply}”
            </p>
            {attempts === 0 && (
              <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
                ⭐ ノーミス！
              </p>
            )}
          </div>
        )}
        {result?.verdict === "grammar" && (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            📝 {result.detail ?? "ぶんぽうを たしかめてみよう"}
          </p>
        )}
        {result?.verdict === "wrong-order" && (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            🤔 ことばは あってるよ！じゅんばんを かんがえてみよう
          </p>
        )}
        {result?.verdict === "wrong-words" && (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-center text-sm font-medium text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
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
            className="rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-base font-semibold shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-200 active:translate-y-0 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
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
            className="rounded-full bg-emerald-600 px-8 py-3 text-base font-bold text-white shadow transition hover:bg-emerald-700"
          >
            つぎへ →
          </button>
        ) : (
          <>
            <button
              onClick={clearAll}
              className="rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              やりなおす
            </button>
            <button
              onClick={submit}
              disabled={placed.length === 0}
              className="rounded-full bg-zinc-900 px-8 py-3 text-base font-bold text-white shadow transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← ホーム
        </Link>
        <h1 className="text-lg font-bold">🧩 単語ならべかえ</h1>
        <span className="w-14 text-right text-sm text-zinc-400">
          ⭐ {cleared}
        </span>
      </header>

      <div className="mt-6 flex-1">
        {finished ? (
          <div className="flex flex-col items-center rounded-3xl border border-zinc-200 bg-zinc-50 px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-5xl">🎊</p>
            <h2 className="mt-4 text-2xl font-bold">ぜんぶ できた！</h2>
            <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
              ⭐ {cleared} / {total} 問 クリア
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={restart}
                className="rounded-full bg-zinc-900 px-7 py-3 text-base font-bold text-white shadow transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                もういちど
              </button>
              <Link
                href="/"
                className="rounded-full border border-zinc-300 px-7 py-3 text-base font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
