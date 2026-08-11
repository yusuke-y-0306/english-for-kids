const features = [
  { emoji: "🃏", title: "フラッシュカード", desc: "英単語を楽しく覚えよう" },
  { emoji: "🎤", title: "発音練習", desc: "声に出して練習しよう" },
  { emoji: "🎮", title: "クイズ・ゲーム", desc: "遊びながら学ぼう" },
  { emoji: "📈", title: "進捗管理", desc: "がんばりを見える化" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        🧒📚 English for Kids
      </h1>
      <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
        子供たちが楽しく英語を学べるアプリ
      </p>

      <section className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-3xl">{f.emoji}</div>
            <h2 className="mt-3 text-lg font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {f.desc}
            </p>
          </div>
        ))}
      </section>

      <footer className="mt-12 text-sm text-zinc-400">
        🚧 開発中 — 随時アップデート予定
      </footer>
    </main>
  );
}
