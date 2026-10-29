import type { Metadata } from "next";
import PronunciationPanel from "./PronunciationPanel";

/**
 * 発音練習 — issue #2
 *
 * 認証は `(protected)/layout.tsx` が担保する。
 * 音声の処理はすべてクライアント (端末内) で完結し、サーバへは
 * 「単語 ID と 3 段階スコア」だけを送る (issue #32)。
 */

export const metadata: Metadata = {
  title: "発音練習 | こども英語ひろば",
  description: "マイクに話しかけて、英語の発音をためしてみよう。",
};

export default function PronunciationPage() {
  return <PronunciationPanel />;
}
