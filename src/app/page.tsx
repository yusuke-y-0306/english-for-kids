import Link from "next/link";
import HeroScene from "@/components/HeroScene";
import SiteHeader from "@/components/SiteHeader";
import FeatureIcon, { type FeatureIconName } from "@/components/FeatureIcon";

type Feature = {
  icon: FeatureIconName;
  title: string;
  en: string;
  desc: string;
  href?: string;
  bg: string;
  ink: string;
  ring: string;
};

const features: Feature[] = [
  {
    icon: "cards",
    title: "フラッシュカード",
    en: "Flashcards",
    desc: "カードをめくって、英単語をぱっと覚えよう。",
    href: "/flashcards",
    bg: "bg-[#fff3d6]",
    ink: "text-[#a85f08]",
    ring: "#e0b21c",
  },
  {
    icon: "puzzle",
    title: "単語ならべかえ",
    en: "Word Builder",
    desc: "ことばをならべて、ただしい ぶんを作ろう。",
    href: "/build",
    bg: "bg-[#e6f6ff]",
    ink: "text-[#1a6f95]",
    ring: "#4dc9f6",
  },
  {
    icon: "mic",
    title: "発音練習",
    en: "Speak",
    desc: "声に出して、はきはき えいご。",
    bg: "bg-[#ffeaf1]",
    ink: "text-[#b03a63]",
    ring: "#ff8fb0",
  },
  {
    icon: "game",
    title: "クイズ・ゲーム",
    en: "Games",
    desc: "あそびながら、いつのまにか覚えちゃう。",
    href: "/quiz",
    bg: "bg-[#eef7e2]",
    ink: "text-[#38702f]",
    ring: "#8fd06a",
  },
  {
    icon: "chart",
    title: "進捗管理",
    en: "Progress",
    desc: "がんばりが 見えると、もっと うれしい。",
    bg: "bg-[#f1ecff]",
    ink: "text-[#5b3cb4]",
    ring: "#a17bf0",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* ---------------------------------------------------------------
          ヒーロー：左にことば、右にえ（重ならない2カラム構成）
      ---------------------------------------------------------------- */}
      <section className="relative mx-auto w-full max-w-6xl px-4 pt-8 pb-14 sm:px-6 sm:pt-12">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-10">
          {/* ことば */}
          <div className="anim-pop">
            <span className="inline-flex items-center gap-2 rounded-full bg-badge px-4 py-1.5 font-display text-[0.72rem] font-semibold tracking-[0.18em] text-cream shadow-[0_3px_0_rgba(61,50,41,0.25)]">
              BUDDY &amp; FRIENDS
            </span>

            <h1 className="mt-5 text-[2.2rem] leading-[1.22] font-extrabold tracking-tight text-ink sm:text-[2.9rem]">
              <span className="block">さあ、</span>
              <span className="block">
                <span className="relative inline-block">
                  <span className="relative z-10">英語の</span>
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-1 z-0 h-3.5 rounded-full bg-rainbow-yellow"
                  />
                </span>
                ぼうけんへ！
              </span>
            </h1>

            <p className="mt-5 max-w-md text-[1.02rem] leading-[1.9] font-bold text-[#5b4a3c] sm:text-lg">
              クマの Buddy と いっしょに、
              <br />
              あそびながら 英語を まなぼう。
              <br />
              カード・ならべかえ・はつおん——
              ぜんぶ この ひろばで。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/flashcards"
                className="inline-flex min-h-12 items-center rounded-full bg-[#f4801f] px-7 py-3.5 text-base font-extrabold text-white shadow-[0_5px_0_#c25f0d] transition hover:-translate-y-0.5 hover:shadow-[0_7px_0_#c25f0d] active:translate-y-1 active:shadow-[0_2px_0_#c25f0d]"
              >
                さっそく あそぶ
              </Link>
              <Link
                href="#menu"
                className="inline-flex min-h-12 items-center rounded-full border-[3px] border-badge/25 bg-white px-7 py-3.5 text-base font-extrabold text-badge shadow-[0_5px_0_rgba(138,90,59,0.22)] transition hover:-translate-y-0.5 hover:border-badge/40 active:translate-y-1 active:shadow-[0_2px_0_rgba(138,90,59,0.22)]"
              >
                メニューを みる
              </Link>
            </div>

            <p className="mt-7 flex items-center gap-2 font-display text-[0.7rem] font-semibold tracking-[0.18em] text-[#5b4a3c]">
              <Sprout className="h-4 w-4 shrink-0" />
              KODOMO EIGO HIROBA — FOR AGES 4–9
            </p>
          </div>

          {/* え */}
          <div className="relative">
            <div className="overflow-hidden rounded-[32px] border-4 border-white bg-sky-bottom shadow-[0_18px_40px_rgba(122,104,87,0.22)]">
              <HeroScene className="block h-auto w-full" />
            </div>
            <span className="absolute -top-3 -right-2 rotate-6 rounded-full bg-white px-4 py-2 font-display text-[0.7rem] font-semibold tracking-[0.14em] text-badge shadow-[0_4px_0_rgba(61,50,41,0.14)] sm:-right-3">
              HELLO!
            </span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          メニュー
      ---------------------------------------------------------------- */}
      <section id="menu" className="relative w-full px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-[32px] bg-white/70 px-5 py-10 shadow-[0_10px_30px_rgba(122,104,87,0.10)] sm:px-8">
            <div className="flex flex-col items-center text-center">
              <span className="rounded-full bg-[#f4801f] px-4 py-1.5 font-display text-[0.68rem] font-semibold tracking-[0.22em] text-white">
                MENU
              </span>
              <h2 className="mt-4 text-[1.85rem] font-extrabold tracking-tight text-ink sm:text-4xl">
                きょうは なにで あそぶ？
              </h2>
              <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed font-bold text-[#5b4a3c] sm:text-base">
                すきな メニューを えらんでね。できたものから ふえていくよ。
              </p>
            </div>

            <ul className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => {
                const inner = (
                  <>
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_3px_0_rgba(61,50,41,0.12)]">
                      <FeatureIcon name={f.icon} className="h-9 w-9" />
                    </span>
                    <span className="mt-4 block text-lg font-extrabold text-ink">
                      {f.title}
                    </span>
                    <span
                      className={`mt-1 block font-display text-[0.64rem] font-semibold tracking-[0.16em] uppercase ${f.ink}`}
                    >
                      {f.en}
                    </span>
                    <span className="mt-2 block text-sm leading-relaxed font-bold text-[#5b4a3c]">
                      {f.desc}
                    </span>
                    <span className="mt-auto pt-5">
                      {f.href ? (
                        <span
                          className="inline-flex min-h-11 items-center rounded-full bg-badge px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_rgba(61,50,41,0.28)] transition group-hover:bg-[#75492e]"
                        >
                          あそぶ
                          <ArrowRight className="ml-1.5 h-4 w-4" />
                        </span>
                      ) : (
                        <span className="inline-flex min-h-12 items-center rounded-full border-2 border-dashed border-[#8f7a5e] bg-white/70 px-5 py-2.5 text-sm font-extrabold text-[#5b4a3c]">
                          じゅんびちゅう
                        </span>
                      )}
                    </span>
                  </>
                );

                const base = `group flex h-full flex-col rounded-[26px] border-4 border-white p-6 text-left shadow-[0_8px_20px_rgba(122,104,87,0.14)] transition ${f.bg}`;

                return (
                  <li key={f.title} className="anim-pop" style={{ animationDelay: `${i * 70}ms` }}>
                    {f.href ? (
                      <Link
                        href={f.href}
                        className={`${base} hover:-translate-y-1.5 hover:shadow-[0_16px_30px_rgba(122,104,87,0.22)]`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={base}>{inner}</div>
                    )}
                  </li>
                );
              })}

              {/* 6枚目：これから ふえるよ（他カードと同じ骨格で揃える） */}
              <li className="anim-pop" style={{ animationDelay: "350ms" }}>
                <div className="flex h-full flex-col rounded-[26px] border-4 border-dashed border-[#e2d3bd] bg-[#fff8ec] p-6 text-left">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_3px_0_rgba(61,50,41,0.10)]">
                    <Sparkle className="h-8 w-8" />
                  </span>
                  <span className="mt-4 block text-lg font-extrabold text-ink">
                    あたらしい あそび
                  </span>
                  <span className="mt-1 block font-display text-[0.64rem] font-semibold tracking-[0.16em] uppercase text-[#8a6a3a]">
                    Coming Soon
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed font-bold text-[#5b4a3c]">
                    うた・よみきかせ・れんしゅうノート… つぎつぎ ふえるよ。
                  </span>
                  <span className="mt-auto pt-5">
                    <span className="inline-flex min-h-12 items-center rounded-full border-2 border-dashed border-[#8f7a5e] bg-white/70 px-5 py-2.5 text-sm font-extrabold text-[#5b4a3c]">
                      おたのしみに
                    </span>
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          フッター
      ---------------------------------------------------------------- */}
      <footer className="mt-auto border-t-2 border-white bg-white/80">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <div className="flex items-center gap-2.5">
            <Sprout className="h-5 w-5 shrink-0" />
            <p className="text-sm font-extrabold text-ink">
              こども英語ひろば
              <span className="ml-2 font-display text-[0.6rem] font-semibold tracking-[0.2em] text-[#7a6857]">
                BUDDY &amp; FRIENDS
              </span>
            </p>
          </div>
          <p className="text-[0.82rem] font-bold text-[#5b4a3c]">
            開発中 — あたらしい あそびを どんどん ふやしていきます
          </p>
        </div>
      </footer>
    </>
  );
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4Z"
        fill="#ffd93d"
        stroke="#e0b21c"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sprout({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M12 21v-7" stroke="#2f8f4e" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 14c-4 0-6.5-2.4-6.5-6.5C9.5 7.5 12 10 12 14Z" fill="#6cc24a" />
      <path d="M12 14c4 0 6.5-2.4 6.5-6.5C14.5 7.5 12 10 12 14Z" fill="#a8e07a" />
    </svg>
  );
}
