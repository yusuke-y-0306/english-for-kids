import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth/session";
import { loadProgressSnapshot, type ProgressSnapshot } from "@/lib/progress/snapshot";
import { MASTERY_LABELS, type DailySlice, type WordMastery } from "@/lib/progress/summary";
import { findWordById } from "@/lib/words";

/**
 * 進捗ページ — issue #68 (親: #4 進捗管理)
 *
 * 「がんばりが 見えると、もっと うれしい」の画面。
 *
 * 設計の要点:
 *  - **SSR で直接集計する** (`loadProgressSnapshot()`)。クライアント fetch を挟まないので
 *    数字がちらつかない。API (#67) と同じ関数を通すので表示と JSON が食い違わない
 *  - **グラフは自前の SVG**。外部ライブラリを足さない (依存ゼロ・CSP もそのまま)
 *  - **inline script を書かない**。折りたたみは `<details>` を使う (JS 不要 = CSP の
 *    nonce 経路に乗せる必要がない)
 *  - 360px 幅で崩れないよう、固定幅を置かず `w-full` + `viewBox` のスケールに頼る
 *  - まだ何もしていない子には **空状態**（責めない文言＋あそびへの導線）を出す
 *
 * 認証は `(protected)/layout.tsx` が担保する (未ログインは /login へ 307)。
 */

export const metadata: Metadata = {
  title: "がんばりの きろく | こども英語ひろば",
  description: "クイズとカードと発音の がんばりを、グラフで ふりかえろう。",
};

/** グラフに出す日数 (issue の指定は直近 7 日) */
const CHART_DAYS = 7;
/** 単語リストに出す上限 (全 48 語を並べると 360px では読めない) */
const WORD_LIST_LIMIT = 24;

export default async function ProgressPage() {
  const user = await getCurrentUser();
  if (!user) {
    // (protected)/layout.tsx が先に /login へ送るので、ここは保険
    return null;
  }

  const snapshot = await loadProgressSnapshot(user.id, { days: CHART_DAYS });
  const today = snapshot.days[snapshot.days.length - 1];
  const isEmpty =
    snapshot.streak.lastStudyDay === null &&
    Object.keys(snapshot.words).length === 0 &&
    snapshot.pronunciation.totalAttempts === 0;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6">
        <header className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-badge px-4 py-1.5 font-display text-[0.68rem] font-semibold tracking-[0.2em] text-cream shadow-[0_3px_0_rgba(61,50,41,0.25)]">
            PROGRESS
          </span>
          <h1 className="mt-4 text-[1.7rem] leading-tight font-extrabold tracking-tight text-ink sm:text-4xl">
            がんばりの きろく
          </h1>
          <p className="mt-3 text-[0.9rem] leading-relaxed font-bold text-[#5b4a3c] sm:text-base">
            クイズと カードと はつおんの がんばりが、ここに たまっていくよ。
            <br className="sm:hidden" />
            <span className="text-[#8f7a5e]">（おうちの かたへ: 学習量の めやすです）</span>
          </p>
        </header>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="mt-7 space-y-5">
            <StreakCard snapshot={snapshot} />
            <TodayCard today={today} totalAttempts={snapshot.pronunciation.totalAttempts} />
            <ChartCard days={snapshot.days} />
            <CategoryCard snapshot={snapshot} />
            <WordsCard words={snapshot.words} />
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-10 text-center sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-full border-[3px] border-badge/25 bg-white px-6 py-2.5 text-sm font-extrabold text-badge shadow-[0_4px_0_rgba(138,90,59,0.18)] transition hover:-translate-y-0.5 active:translate-y-0.5"
        >
          ホームへ もどる
        </Link>
      </footer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 空状態                                                              */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <section className="mt-7 rounded-[28px] border-4 border-white bg-[#f1ecff] px-5 py-8 text-center shadow-[0_10px_26px_rgba(122,104,87,0.14)] sm:px-8">
      <span aria-hidden className="text-5xl">
        🌱
      </span>
      <h2 className="mt-4 text-xl font-extrabold text-ink sm:text-2xl">
        まだ きろくが ないよ
      </h2>
      <p className="mx-auto mt-3 max-w-sm text-[0.92rem] leading-relaxed font-bold text-[#5b4a3c]">
        クイズや カードで あそぶと、
        <br />
        ここに がんばりが たまっていくよ。
        <br />
        ひとつ やってみよう！
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/quiz"
          className="inline-flex min-h-12 items-center rounded-full bg-[#f4801f] px-6 py-3 text-base font-extrabold text-white shadow-[0_5px_0_#c25f0d] transition hover:-translate-y-0.5 hover:shadow-[0_7px_0_#c25f0d] active:translate-y-1 active:shadow-[0_2px_0_#c25f0d]"
        >
          クイズで あそぶ
        </Link>
        <Link
          href="/flashcards"
          className="inline-flex min-h-12 items-center rounded-full border-[3px] border-[#8fd06a] bg-white px-6 py-3 text-base font-extrabold text-[#38702f] shadow-[0_5px_0_rgba(56,112,47,0.22)] transition hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_rgba(56,112,47,0.22)]"
        >
          カードを ひらく
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ストリーク                                                          */
/* ------------------------------------------------------------------ */

function StreakCard({ snapshot }: { snapshot: ProgressSnapshot }) {
  const { streak } = snapshot;
  /* 「今日やった」「今日まだ（でも続いている）」「途切れた」を文言で区別する */
  const headline =
    streak.current > 0 ? `${streak.current} 日 れんぞく` : streak.lastStudyDay ? "つぎは きょう！" : "きょうから はじめよう";

  const note = streak.studiedToday
    ? "きょうも できたね！"
    : streak.current > 0
      ? "きょうも やると のびるよ"
      : streak.lastStudyDay
        ? "1 日 あくと カウントが もどるよ"
        : "まずは 1 日 やってみよう";

  return (
    <section className="rounded-[28px] border-4 border-white bg-[#fff3d6] px-5 py-6 text-center shadow-[0_10px_26px_rgba(122,104,87,0.14)] sm:px-8">
      <p className="font-display text-[0.62rem] font-semibold tracking-[0.22em] text-[#a85f08]">
        STREAK
      </p>
      <p className="mt-2 flex items-center justify-center gap-2">
        <span aria-hidden className="text-4xl sm:text-5xl">
          {streak.current > 0 ? "🔥" : "🌱"}
        </span>
        <span className="text-2xl font-extrabold text-ink sm:text-[2rem]">{headline}</span>
      </p>
      <p className="mt-2 text-sm font-bold text-[#5b4a3c]">{note}</p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs font-extrabold">
        <span className="rounded-full bg-white/80 px-3 py-1.5 text-[#5b4a3c]">
          さいちょう {streak.longest} 日
        </span>
        <span className="rounded-full bg-white/80 px-3 py-1.5 text-[#5b4a3c]">
          さいご {streak.lastStudyDay ? formatDayLabel(streak.lastStudyDay) : "まだ"}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* きょうの できた                                                      */
/* ------------------------------------------------------------------ */

function TodayCard({
  today,
  totalAttempts,
}: {
  today: DailySlice | undefined;
  totalAttempts: number;
}) {
  const quiz = today?.quiz ?? { rounds: 0, correct: 0, total: 0, accuracy: 0 };
  const pronunciation = today?.pronunciation ?? { attempts: 0, ok: 0 };
  const cards = today?.cards ?? { views: 0 };

  return (
    <section className="rounded-[28px] border-4 border-white bg-white/80 px-5 py-6 shadow-[0_8px_22px_rgba(122,104,87,0.12)] sm:px-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-extrabold text-ink">きょうの できた</h2>
        <span className="text-xs font-extrabold text-[#8f7a5e]">{formatDayLabel(today?.day ?? "")}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <Stat label="クイズ" value={`${quiz.rounds}`} unit="ラウンド" color="bg-[#eef7e2]" />
        <Stat label="せいかい" value={`${quiz.accuracy}`} unit="%" color="bg-[#e6f6ff]" />
        <Stat label="カード" value={`${cards.views}`} unit="まい" color="bg-[#fff3d6]" />
        <Stat label="はつおん" value={`${pronunciation.attempts}`} unit="かい" color="bg-[#ffeaf1]" />
      </dl>

      <p className="mt-3 text-[0.8rem] font-bold text-[#8f7a5e]">
        きょうは クイズ {quiz.correct} / {quiz.total} もん せいかい、カード {cards.views} まい、
        はつおんは {pronunciation.ok} かい「できた」。いままでに はつおん {totalAttempts} かい
        れんしゅう したよ。
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <div className={`rounded-2xl ${color} px-2 py-3 text-center`}>
      <dt className="text-[0.66rem] font-extrabold text-[#5b4a3c]">{label}</dt>
      <dd className="mt-1 text-xl leading-none font-extrabold text-ink sm:text-2xl">
        {value}
        <span className="ml-0.5 text-[0.62rem] font-extrabold text-[#8f7a5e]">{unit}</span>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 直近 7 日の棒グラフ（SVG を自前で描く）                              */
/* ------------------------------------------------------------------ */

const CHART = {
  width: 340,
  height: 196,
  padX: 8,
  baseline: 150,
  top: 32,
  gap: 7,
} as const;

function ChartCard({ days }: { days: DailySlice[] }) {
  const studied = days.filter((day) => day.studied).length;
  return (
    <section className="rounded-[28px] border-4 border-white bg-white/80 px-5 py-6 shadow-[0_8px_22px_rgba(122,104,87,0.12)] sm:px-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-extrabold text-ink">さいきん 7 日</h2>
        <span className="text-xs font-extrabold text-[#8f7a5e]">{studied} 日 べんきょうした</span>
      </div>
      <p className="mt-1 text-[0.75rem] font-bold text-[#8f7a5e]">
        たての ながさ = クイズの こたえた かず ＋ カードの まいすう ＋ はつおんの かいすう
      </p>

      <div className="mt-3">
        <WeeklyChart days={days} />
      </div>

      <p className="mt-2 flex items-center justify-center gap-3 text-[0.7rem] font-extrabold text-[#8f7a5e]">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#ff9f43]" />
          きょう
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#a8e07a]" />
          できた日
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#efe6d9]" />
          おやすみ
        </span>
      </p>
    </section>
  );
}

/** 学習量 (クイズの出題数 + カードの枚数 + 発音の回数) */
function amountOf(day: DailySlice): number {
  return day.quiz.total + day.cards.views + day.pronunciation.attempts;
}

function WeeklyChart({ days }: { days: DailySlice[] }) {
  const count = days.length;
  if (count === 0) return null;

  const innerWidth = CHART.width - CHART.padX * 2;
  const barWidth = (innerWidth - CHART.gap * (count - 1)) / count;
  const maxAmount = Math.max(1, ...days.map(amountOf));
  const maxBarHeight = CHART.baseline - CHART.top;

  const label = days
    .map((day) => `${formatDayLabel(day.day)} ${amountOf(day)}`)
    .join("、");

  return (
    <svg
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`さいきん ${count} 日の 学習量: ${label}`}
    >
      <title>{`さいきん ${count} 日の 学習量`}</title>

      {/* 土台の線 */}
      <line
        x1={CHART.padX}
        y1={CHART.baseline}
        x2={CHART.width - CHART.padX}
        y2={CHART.baseline}
        stroke="#e2d3bd"
        strokeWidth={2}
        strokeLinecap="round"
      />

      {days.map((day, index) => {
        const amount = amountOf(day);
        const x = CHART.padX + index * (barWidth + CHART.gap);
        const height = amount === 0 ? 4 : Math.max(12, Math.round((amount / maxAmount) * maxBarHeight));
        const y = CHART.baseline - height;
        const isToday = index === count - 1;
        const fill = amount === 0 ? "#efe6d9" : isToday ? "#ff9f43" : "#a8e07a";
        const centerX = x + barWidth / 2;

        return (
          <g key={day.day}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx={Math.min(7, barWidth / 2)}
              fill={fill}
            />
            {amount > 0 ? (
              <text
                x={centerX}
                y={y - 6}
                textAnchor="middle"
                fontSize={11}
                fontWeight={800}
                fill="#5b4a3c"
              >
                {amount}
              </text>
            ) : null}
            <text
              x={centerX}
              y={CHART.baseline + 20}
              textAnchor="middle"
              fontSize={12}
              fontWeight={800}
              fill={isToday ? "#c25f0d" : "#8f7a5e"}
            >
              {weekdayOf(day.day)}
            </text>
            <text
              x={centerX}
              y={CHART.baseline + 36}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={700}
              fill="#a89684"
            >
              {day.day.slice(5).replace("-", "/")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* カテゴリ別                                                          */
/* ------------------------------------------------------------------ */

function CategoryCard({ snapshot }: { snapshot: ProgressSnapshot }) {
  return (
    <section className="rounded-[28px] border-4 border-white bg-white/80 px-5 py-6 shadow-[0_8px_22px_rgba(122,104,87,0.12)] sm:px-7">
      <h2 className="text-lg font-extrabold text-ink">カテゴリ別 できた かず</h2>
      <p className="mt-1 text-[0.75rem] font-bold text-[#8f7a5e]">
        クイズで 3 かい せいかい、または 1 かい せいかい＋はつおん ok で「おぼえた」。
        カードで 見た ことばは「れんしゅうちゅう」になるよ。
      </p>

      <ul className="mt-4 space-y-3.5">
        {snapshot.categories.map((category) => {
          const masteredRate = category.total > 0 ? (category.mastered / category.total) * 100 : 0;
          const learningRate = category.total > 0 ? (category.learning / category.total) * 100 : 0;
          return (
            <li key={category.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm font-extrabold">
                <span className="text-ink">
                  <span aria-hidden className="mr-1.5">
                    {category.emoji}
                  </span>
                  {category.label}
                </span>
                <span className="text-[#8f7a5e]">
                  {category.mastered} / {category.total} ご
                </span>
              </div>
              <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-[#efe6d9]">
                <span
                  aria-hidden
                  className="h-full bg-[#8fd06a]"
                  style={{ width: `${masteredRate}%` }}
                />
                <span
                  aria-hidden
                  className="h-full bg-[#ffd93d]"
                  style={{ width: `${learningRate}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 単語の ようす（JS なしの折りたたみ）                                 */
/* ------------------------------------------------------------------ */

function WordsCard({ words }: { words: Record<string, WordMastery> }) {
  const all = Object.values(words);
  const mastered = all.filter((word) => word.level === "mastered");
  const learning = all.filter((word) => word.level === "learning");
  if (all.length === 0) return null;

  return (
    <section className="rounded-[28px] border-4 border-white bg-white/80 px-5 py-5 shadow-[0_8px_22px_rgba(122,104,87,0.12)] sm:px-7">
      {/* <details> なので JS 不要 (CSP の inline script を増やさない) */}
      <details className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-extrabold text-ink [&::-webkit-details-marker]:hidden">
          <span>
            ことばの ようす
            <span className="ml-2 text-xs font-extrabold text-[#8f7a5e]">
              {MASTERY_LABELS.mastered} {mastered.length} ご / {MASTERY_LABELS.learning}{" "}
              {learning.length} ご
            </span>
          </span>
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f1ecff] text-sm font-extrabold text-[#5b3cb4] transition group-open:rotate-180"
          >
            ▾
          </span>
        </summary>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <WordList
            title={MASTERY_LABELS.mastered}
            emoji="🌟"
            words={mastered}
            emptyText="まだ ないよ。クイズで 3 かい せいかい すると ふえるよ。"
          />
          <WordList
            title={MASTERY_LABELS.learning}
            emoji="✏️"
            words={learning}
            emptyText="これから ふえていくよ。"
          />
        </div>
      </details>
    </section>
  );
}

function WordList({
  title,
  emoji,
  words,
  emptyText,
}: {
  title: string;
  emoji: string;
  words: WordMastery[];
  emptyText: string;
}) {
  const shown = words.slice(0, WORD_LIST_LIMIT);
  const rest = words.length - shown.length;

  return (
    <div>
      <p className="text-sm font-extrabold text-[#5b4a3c]">
        <span aria-hidden className="mr-1.5">
          {emoji}
        </span>
        {title}
        <span className="ml-1.5 text-xs font-extrabold text-[#8f7a5e]">{words.length} ご</span>
      </p>

      {words.length === 0 ? (
        <p className="mt-2 text-[0.8rem] font-bold text-[#8f7a5e]">{emptyText}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((word) => {
            const found = findWordById(word.id);
            const label = found ? found.word.en : word.id;
            const reading = found ? found.word.ja : "";
            return (
              <li
                key={word.id}
                className="flex items-center gap-1.5 rounded-full bg-[#fff8ec] px-2.5 py-1.5 text-xs font-extrabold text-ink"
              >
                {found ? (
                  <span aria-hidden className="text-sm">
                    {found.word.emoji}
                  </span>
                ) : null}
                {label}
                {reading ? <span className="font-bold text-[#8f7a5e]">{reading}</span> : null}
              </li>
            );
          })}
          {rest > 0 ? (
            <li className="rounded-full bg-[#efe6d9] px-2.5 py-1.5 text-xs font-extrabold text-[#5b4a3c]">
              ＋{rest} ご
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 日付の表示（JST）                                                   */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD` → `M/D` */
function formatDayLabel(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [, month, date] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
}

/** `YYYY-MM-DD` → 曜日 1 文字 (JST) */
function weekdayOf(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  /* 日付キーは UTC 0 時。JST でも同じ日の 9 時なので曜日は動かない */
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(new Date(`${day}T00:00:00Z`));
}
