import type { Metadata } from "next";
import PronunciationPanel from "./PronunciationPanel";
import WasmWarmup from "@/components/speech/WasmWarmup";

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
  return (
    <>
      {/* 画面を出したまま裏でモデルを読み込む (issue #2)。
          エンジンが 'unsafe-eval' を必要とするため、このページだけに置いている。 */}
      <WasmWarmup />
      <PronunciationPanel />
    </>
  );
}
