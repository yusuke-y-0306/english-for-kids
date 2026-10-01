"use client";

import { useState } from "react";
import Link from "next/link";
import { categories } from "@/lib/words";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function FlashcardsPage() {
  const [catId, setCatId] = useState(categories[0].id);
  const cat = categories.find((c) => c.id === catId) ?? categories[0];

  // `order` holds positions into cat.words, so we can shuffle without losing data.
  const [order, setOrder] = useState<number[]>(() =>
    categories[0].words.map((_, i) => i),
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const word = cat.words[order[index]];
  const total = cat.words.length;

  function selectCategory(id: string) {
    const nextCat = categories.find((c) => c.id === id) ?? categories[0];
    setCatId(id);
    setOrder(nextCat.words.map((_, i) => i));
    setIndex(0);
    setFlipped(false);
  }

  function go(step: number) {
    setFlipped(false);
    setIndex((i) => (i + step + total) % total);
  }

  function doShuffle() {
    setOrder((o) => shuffle(o));
    setIndex(0);
    setFlipped(false);
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
        <h1 className="text-lg font-bold">🃏 フラッシュカード</h1>
        <span className="w-14 text-right text-sm text-zinc-400">
          {index + 1} / {total}
        </span>
      </header>

      {/* Category selector */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => selectCategory(c.id)}
            aria-pressed={c.id === catId}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              c.id === catId
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {/* Card */}
      <div className="mt-8 [perspective:1200px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label="カードをめくる"
          className="relative block h-72 w-full [transform-style:preserve-3d] transition-transform duration-500 ease-out"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* Front (English) */}
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-gradient-to-br ${cat.color} p-6 text-white shadow-lg [backface-visibility:hidden]`}
          >
            <div className="text-7xl drop-shadow-sm">{word.emoji}</div>
            <div className="mt-4 text-4xl font-extrabold tracking-tight drop-shadow-sm">
              {word.en}
            </div>
            <div className="mt-4 text-xs font-medium text-white/80">
              タップして いみを みる 👆
            </div>
          </div>

          {/* Back (Japanese) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-zinc-200 bg-white p-6 shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)] dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-7xl">{word.emoji}</div>
            <div className="mt-4 text-4xl font-extrabold tracking-tight">
              {word.ja}
            </div>
            <div className="mt-3 text-lg font-medium text-zinc-400">
              {word.en}
            </div>
          </div>
        </button>
      </div>

      {/* Controls */}
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          onClick={() => go(-1)}
          className="rounded-full bg-zinc-100 px-6 py-3 text-lg font-semibold transition hover:bg-zinc-200 active:scale-95 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          aria-label="まえのカード"
        >
          ◀
        </button>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 active:scale-95 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          めくる 🔄
        </button>
        <button
          onClick={() => go(1)}
          className="rounded-full bg-zinc-100 px-6 py-3 text-lg font-semibold transition hover:bg-zinc-200 active:scale-95 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          aria-label="つぎのカード"
        >
          ▶
        </button>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          onClick={doShuffle}
          className="text-sm text-zinc-400 underline-offset-4 transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          🔀 シャッフル
        </button>
      </div>
    </main>
  );
}
