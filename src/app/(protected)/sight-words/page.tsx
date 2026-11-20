import type { Metadata } from "next";
import SightWordsPanel from "./SightWordsPanel";

/**
 * サイトワード — issue #87
 *
 * 認証は `(protected)/layout.tsx` が担保する。
 * 音声は生成済みの単語 mp3 を再生するだけで、サーバへ音声は送らない。
 */

export const metadata: Metadata = {
  title: "サイトワード | こども英語ひろば",
  description: "the・and・is など、よく出ることばを 3 ステップで練習しよう。",
};

export default function SightWordsPage() {
  return <SightWordsPanel />;
}
