"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MuteToggle } from "@/components/audio/MuteToggle";
import { SpeakButton } from "@/components/audio/SpeakButton";
import { Button, Chip } from "@/components/ui";
import { newClientId } from "@/lib/client-id";
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
  const [showAllCats, setShowAllCats] = useState(false);
  const cat = categories.find((c) => c.id === catId) ?? categories[0];

  // `order` holds positions into cat.words, so we can shuffle without losing data.
  const [order, setOrder] = useState<number[]>(() =>
    categories[0].words.map((_, i) => i),
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  /* 進捗の記録 (#76)。同じページ表示中に同じ単語を何度も数えない */
  const recordedRef = useRef<Set<string>>(new Set());

  function recordView(id: string) {
    if (recordedRef.current.has(id)) return;
    recordedRef.current.add(id);

    /* 失敗したら印を戻す (次のめくりで再挑戦できる)。遊びは止めない */
    void fetch("/api/progress/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventId: newClientId(), wordId: id }),
    }).catch(() => {
      recordedRef.current.delete(id);
    });
  }

  const word = cat.words[order[index]];
  const total = cat.words.length;

  /* よく使う 6 つだけを横に並べる。残りは「すべて」から選ぶ（17 個の壁を作らない） */
  const quickIds = ["animals", "food", "colors", "numbers", "family", "school"];
  const quickCats = quickIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is (typeof categories)[number] => Boolean(c));
  const quickWithCurrent = quickCats.some((c) => c.id === catId)
    ? quickCats
    : [...quickCats, cat];

  function flip() {
    const next = !flipped;
    setFlipped(next);
    /* 意味を見た瞬間を「1 枚」と数える (おもてを見ただけでは数えない) */
    if (next) recordView(word.id);
  }

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
          className="rounded-full px-3 py-1.5 text-kid-label font-extrabold text-ink-muted transition hover:bg-surface-muted hover:text-ink"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold text-ink sm:text-lg">
          フラッシュカード
        </h1>
        <div className="flex items-center gap-1.5">
          <span
            data-testid="flashcard-progress"
            className="rounded-full bg-surface-muted px-3 py-1.5 text-kid-caption font-extrabold text-secondary"
          >
            {index + 1} / {total}
          </span>
          <MuteToggle />
        </div>
      </header>

      {/* カテゴリえらび — 横スクロール + 「すべて」グリッド (#122) */}
      <div className="mt-5">
        {showAllCats ? (
          <div className="flex justify-end">
            <Chip onClick={() => setShowAllCats(false)}>とじる</Chip>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pr-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {quickWithCurrent.map((c) => (
                <Chip
                  key={c.id}
                  selected={c.id === catId}
                  onClick={() => selectCategory(c.id)}
                >
                  <span aria-hidden className="text-base leading-none">
                    {c.emoji}
                  </span>
                  {c.label}
                </Chip>
              ))}
            </div>
            <Chip
              aria-expanded={false}
              aria-label={`すべての カテゴリ (${categories.length})`}
              onClick={() => setShowAllCats(true)}
            >
              すべて
            </Chip>
          </div>
        )}

        {showAllCats && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-card border-4 border-white bg-surface-raised/85 p-3 shadow-card sm:grid-cols-3">
            {categories.map((c) => (
              <Chip
                key={c.id}
                selected={c.id === catId}
                onClick={() => {
                  selectCategory(c.id);
                  setShowAllCats(false);
                }}
                className="w-full justify-start"
              >
                <span aria-hidden className="text-base leading-none">
                  {c.emoji}
                </span>
                {c.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* カード */}
      <div className="mt-7 [perspective:1200px]">
        <button
          type="button"
          onClick={flip}
          aria-label="カードをめくる"
          data-testid="flashcard"
          className="relative block h-72 w-full [transform-style:preserve-3d] transition-transform duration-500 ease-out active:scale-[0.995] sm:h-80"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* おもてがわ（えいご） */}
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center rounded-card border-4 border-white bg-gradient-to-br ${cat.color} p-6 text-white shadow-float [backface-visibility:hidden]`}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-card border-4 border-white bg-cream p-6 shadow-float [backface-visibility:hidden] [transform:rotateY(180deg)]">
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

      {/* よみあげ (#84)。カードの外に置く (カード自体が button のため) */}
      <div className="mt-4 flex justify-center">
        <SpeakButton word={word} label="えいごで きく" />
      </div>

      {/* そうさ */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={() => go(-1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white text-lg font-extrabold text-[#5b4a3c] shadow-[0_4px_0_rgba(122,104,87,0.18)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
          aria-label="まえのカード"
        >
          ◀
        </button>
        <Button onClick={flip} size="lg" className="px-7">
          めくる
        </Button>
        <button
          onClick={() => go(1)}
          data-testid="flashcard-next"
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
