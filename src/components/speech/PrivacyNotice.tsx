"use client";

/**
 * 音声の扱いについての短い説明 — issue #31
 * 子どもの音声を扱うので、初回に「端末の外に出さない」ことを明示する。
 */
export default function PrivacyNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ${className}`}>
      こえは <strong>端末の なかだけ</strong> で つかうよ。サーバーには おくらないよ。
    </p>
  );
}
