"use client";

import type { RecognitionPath } from "@/lib/speech/recognition-policy";

/**
 * いま音声をどう扱っているかの表示 — issue #31
 * 保護者が「端末内で処理されている」ことを画面で確認できるようにする。
 */

const STYLES: Record<RecognitionPath, { label: string; className: string }> = {
  wasm: { label: "端末内で よみとり", className: "bg-emerald-100 text-emerald-800" },
  device: { label: "端末内で よみとり", className: "bg-emerald-100 text-emerald-800" },
  "self-report": { label: "じこ申告", className: "bg-sky-100 text-sky-800" },
};

export default function RecognitionPathBadge({ path }: { path: RecognitionPath }) {
  const style = STYLES[path];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${style.className}`}>
      {style.label}
    </span>
  );
}
