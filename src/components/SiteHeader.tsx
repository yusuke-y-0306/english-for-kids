import Link from "next/link";

/**
 * SiteHeader — ロゴ(s)・サイト名・「Buddy & Friends」バッジ・ナビゲーション。
 */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="border-b-2 border-white/70 bg-cream/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="group flex items-center gap-3">
            <LogoMark className="h-11 w-11 shrink-0 drop-shadow-[0_3px_0_rgba(138,90,59,0.18)]" />
            <span className="flex flex-col leading-none">
              <span className="text-[1.35rem] font-extrabold tracking-tight text-ink sm:text-[1.6rem]">
                こども英語<span className="text-forest">ひろば</span>
              </span>
              <span className="mt-1 font-display text-[0.58rem] font-semibold uppercase tracking-[0.28em] text-ink-soft">
                Kodomo Eigo Hiroba
              </span>
            </span>
          </Link>

          <span className="ml-2 hidden rounded-full bg-badge px-3 py-1.5 font-display text-xs font-semibold tracking-wide text-cream shadow-[0_2px_0_rgba(61,50,41,0.25)] md:inline-block">
            Buddy &amp; Friends
          </span>

          <nav className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/flashcards"
              className="hidden rounded-full px-3 py-2 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-white hover:text-ink sm:inline-block sm:px-4"
            >
              カード
            </Link>
            <Link
              href="/build"
              className="hidden rounded-full px-3 py-2 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-white hover:text-ink sm:inline-block sm:px-4"
            >
              ぶんを つくる
            </Link>
            <Link
              href="#menu"
              className="rounded-full bg-rainbow-orange px-4 py-2 text-sm font-extrabold text-white shadow-[0_3px_0_#d9701f] transition hover:-translate-y-0.5 hover:shadow-[0_5px_0_#d9701f] active:translate-y-0.5 active:shadow-[0_1px_0_#d9701f] sm:px-5"
            >
              あそぶ
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#ffd93d" />
      <circle cx="32" cy="32" r="30" fill="none" stroke="#e8b520" strokeWidth="3" />
      <path
        d="M12 22h18q4 0 4 4v20q0-4-4-4H12Z"
        fill="#fff8ec"
        stroke="#c98b5e"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M52 22H34q-4 0-4 4v20q0-4 4-4h18Z"
        fill="#fff8ec"
        stroke="#c98b5e"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fontFamily="var(--font-fredoka), sans-serif"
        fontSize="20"
        fontWeight="700"
        fill="#ff6b6b"
      >
        A
      </text>
    </svg>
  );
}
