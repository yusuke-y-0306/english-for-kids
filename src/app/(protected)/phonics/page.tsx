import type { Metadata } from "next";
import PhonicsPanel from "./PhonicsPanel";

/**
 * フォニックス — issue #88
 *
 * 認証は `(protected)/layout.tsx` が担保する。
 * 音声は生成済みの mp3 (`/audio/words/phonics/...`) を再生するだけで、
 * サーバへ音声は送らない。
 */

export const metadata: Metadata = {
  title: "フォニックス | こども英語ひろば",
  description: "もじの おと (フォニーム) と、おわりが おなじ ことばを れんしゅう しよう。",
};

export default function PhonicsPage() {
  return <PhonicsPanel />;
}
