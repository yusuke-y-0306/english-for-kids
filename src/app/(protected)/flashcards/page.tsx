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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      {/* ヘッダー */}
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold text-ink sm:text-lg">
          フラッシュカード
        </h1>
        <span className="rounded-full bg-[#fff6e3] px-3 py-1.5 text-xs font-extrabold text-[#a85f08]">
          {index + 1} / {total}
        </span>
      </header>

      {/* カテゴリえらび */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {categories.map((c) => {
          const active = c.id === catId;
          return (
            <button
              key={c.id}
              onClick={() => selectCategory(c.id)}
              aria-pressed={active}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-extrabold transition ${
                active
                  ? "bg-badge text-white shadow-[0_3px_0_rgba(61,50,41,0.28)]"
                  : "border-2 border-white bg-white text-[#5b4a3c] shadow-[0_3px_0_rgba(122,104,87,0.12)] hover:-translate-y-0.5 hover:bg-[#fff6e3]"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          );
        })}
      </div>

      {/* カード */}
      <div className="mt-7 [perspective:1200px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          aria-label="カードをめくる"
          className="relative block h-72 w-full [transform-style:preserve-3d] transition-transform duration-500 ease-out sm:h-80"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* おもてがわ（えいご） */}
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center rounded-[32px] border-4 border-white bg-gradient-to-br ${cat.color} p-6 text-white shadow-[0_16px_36px_rgba(122,104,87,0.24)] [backface-visibility:hidden]`}
          >
            <div className="text-7xl drop-shadow-sm">{word.emoji}</div>
            <div className="mt-4 text-4xl font-extrabold tracking-tight drop-shadow-sm">
              {word.en}
            </div>
            <div className="mt-5 rounded-full bg-white/25 px-4 py-1.5 text-xs font-extrabold">
              タップして いみを みる
            </div>
          </div>

          {/* うらがわ（にほんご） */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-[32px] border-4 border-white bg-[#fff8ec] p-6 shadow-[0_16px_36px_rgba(122,104,87,0.24)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="text-7xl">{word.emoji}</div>
            <div className="mt-4 text-4xl font-extrabold tracking-tight text-ink">
              {word.ja}
            </div>
            <div className="mt-3 font-display text-lg font-semibold tracking-wide text-[#a85f08]">
              {word.en}
            </div>
          </div>
        </button>
      </div>

      {/* そうさ */}
      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          onClick={() => go(-1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white text-lg font-extrabold text-[#5b4a3c] shadow-[0_4px_0_rgba(122,104,87,0.18)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          aria-label="まえのカード"
        >
          ◀
        </button>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="min-h-12 rounded-full bg-[#f4801f] px-7 py-3 text-sm font-extrabold text-white shadow-[0_4px_0_#c25f0d] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
        >
          めくる
        </button>
        <button
          onClick={() => go(1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white text-lg font-extrabold text-[#5b4a3c] shadow-[0_4px_0_rgba(122,104,87,0.18)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          aria-label="つぎのカード"
        >
          ▶
        </button>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          onClick={doShuffle}
          className="rounded-full px-4 py-2 text-sm font-extrabold text-[#5b4a3c] underline decoration-[#c9b9a6] decoration-2 underline-offset-4 transition hover:bg-white hover:text-ink"
        >
          シャッフル
        </button>
      </div>
    </main>
  );
}
