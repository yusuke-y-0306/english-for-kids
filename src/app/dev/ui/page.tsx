import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  LinkButton,
  SectionHeading,
  StatTile,
} from "@/components/ui";

/**
 * UI カタログ (#120)。
 *
 * 部品を画面に組み込む前に、variant / size / disabled / loading を 1 ページで
 * 目視できるようにする。開発専用 (本番は 404) で、検索にも出さない。
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UI カタログ | こども英語ひろば",
  robots: { index: false, follow: false },
};

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-kid-caption font-extrabold tracking-[0.12em] text-secondary">
            DEV ONLY
          </p>
          <h1 className="mt-1 text-kid-title font-extrabold text-ink">UI カタログ</h1>
          <p className="mt-2 text-kid-label font-bold text-ink-muted">
            トークンと部品の見本。画面に組み込む前にここで確認する。
          </p>
        </div>
        <Link
          href="/"
          className="text-kid-label font-extrabold text-secondary underline underline-offset-4"
        >
          ホームへ戻る
        </Link>
      </header>

      <div className="mt-8 space-y-10">
        <section>
          <SectionHeading title="文字" description="本文 17px、見出し 28px、ヒーロー 44px。10px は使わない。" />
          <Card className="mt-4 space-y-3">
            <p className="text-kid-hero font-extrabold text-ink">英語の ぼうけんへ！</p>
            <p className="text-kid-title font-extrabold text-ink">きょうは なにで あそぶ？</p>
            <p className="text-kid-body font-bold text-ink">
              本文は 17px。子どもが読む文章は、大人のアプリより 1 段大きくする。
            </p>
            <p className="text-kid-label font-bold text-ink-muted">
              補助ラベルは 14px。12px はキャプションまで。
            </p>
            <p className="text-kid-caption font-bold text-ink-muted">
              キャプション 12px。これ未満は使わない。
            </p>
          </Card>
        </section>

        <section>
          <SectionHeading title="色" description="役割で選ぶ。画面ごとに hex を書かない。" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Swatch className="bg-primary text-primary-ink" label="primary" />
            <Swatch className="bg-secondary text-white" label="secondary" />
            <Swatch className="bg-success text-white" label="success" />
            <Swatch className="bg-danger text-white" label="danger" />
            <Swatch className="bg-surface text-ink" label="surface" />
            <Swatch className="bg-surface-muted text-ink" label="surface-muted" />
            <Swatch className="bg-ink text-white" label="ink" />
            <Swatch className="bg-focus text-white" label="focus" />
          </div>
        </section>

        <section>
          <SectionHeading title="ボタン" description="primary は 1 画面に 1 つ。secondary は別の道。ghost は補助。" />
          <Card className="mt-4 flex flex-wrap items-center gap-3">
            <Button>はじめる</Button>
            <Button variant="secondary">メニューを みる</Button>
            <Button variant="ghost">あとで</Button>
            <Button size="lg">大きい primary</Button>
            <Button disabled>押せない</Button>
            <Button loading>保存中</Button>
          </Card>
          <Card className="mt-3 flex flex-wrap items-center gap-3">
            <LinkButton href="/flashcards">カードを ひらく</LinkButton>
            <LinkButton href="/quiz" variant="secondary">
              クイズへ
            </LinkButton>
            <LinkButton href="/" disabled>
              準備中
            </LinkButton>
          </Card>
        </section>

        <section>
          <SectionHeading title="チップ" description="カテゴリ選択。選択中は濃い茶でコントラストを確保。" />
          <Card className="mt-4 flex flex-wrap gap-2">
            <Chip selected>動物</Chip>
            <Chip>たべもの</Chip>
            <Chip>のりもの</Chip>
            <Chip>サイトワード</Chip>
          </Card>
        </section>

        <section>
          <SectionHeading title="カード" description="raised / soft / outline の 3 種類だけ。" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-kid-label font-extrabold text-ink">raised</p>
              <p className="mt-1 text-kid-caption font-bold text-ink-muted">主役の面</p>
            </Card>
            <Card variant="soft">
              <p className="text-kid-label font-extrabold text-ink">soft</p>
              <p className="mt-1 text-kid-caption font-bold text-ink-muted">補助のまとまり</p>
            </Card>
            <Card variant="outline">
              <p className="text-kid-label font-extrabold text-ink">outline</p>
              <p className="mt-1 text-kid-caption font-bold text-ink-muted">情報の囲み</p>
            </Card>
          </div>
        </section>

        <section>
          <SectionHeading title="数字" description="値は 24px 以上。ラベルと値を同じ強さで書かない。" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile label="きょう できた" value="12 語" />
            <StatTile label="れんぞく" value="5 日" tone="primary" />
            <StatTile label="おぼえた" value="48 語" tone="success" />
          </div>
        </section>

        <section>
          <SectionHeading title="空状態" description="破線は使わない。責めず、次の一歩を 1 つだけ。" />
          <div className="mt-4">
            <EmptyState
              title="まだ きろくが ないよ"
              description="カードを 1 まい めくると、ここに きょうの がんばりが 出るよ。"
              action={<LinkButton href="/flashcards">カードを ひらく</LinkButton>}
            />
          </div>
        </section>

        <section>
          <SectionHeading title="ルール" />
          <Card variant="soft" className="mt-4">
            <ul className="space-y-2 text-kid-label font-bold text-ink">
              <li>・影は 3 段、角丸は 3 段。新しい値を作らない。</li>
              <li>・色はトークン経由。hex の直書きをしない。</li>
              <li>・タップ領域は 44px 以上。hover だけに頼らない。</li>
              <li>・10px の大文字ラベルを作らない。</li>
              <li>・破線の枠を「準備中」に使わない。</li>
            </ul>
          </Card>
        </section>
      </div>
    </main>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <div className={`rounded-card border-4 border-white p-4 shadow-card ${className}`}>
      <p className="text-kid-label font-extrabold">{label}</p>
    </div>
  );
}
