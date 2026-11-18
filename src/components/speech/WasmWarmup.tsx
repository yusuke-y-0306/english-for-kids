"use client";

import { useEffect } from "react";
import { detectWasmReadiness, isTranscriberLoaded, warmTranscriber } from "@/lib/speech/wasm-recognition";
import { shouldWarmUpWasm } from "@/lib/speech/wasm-policy";

/**
 * モデルの事前読み込み — issue #2
 *
 * 発音練習のページを開いてから 51MB のモデルを読み込むと、iPhone では
 * **40 秒以上**かかる (実測)。そのあいだ「はなす」は押せないので、
 * 子どもには「壊れている」ように見える。
 *
 * そこでホームなどを見ているあいだに、裏で読み込んでおく:
 *  - モデルが**すでに端末にある**ときだけ (51MB の取得は本人の操作から)
 *  - 描画が終わってから (requestIdleCallback / 1.5 秒後)
 *  - Save-Data のときは何もしない
 *
 * 失敗しても握りつぶす。発音練習の画面が、いつもどおり準備をやり直す。
 */
export default function WasmWarmup() {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const readiness = await detectWasmReadiness().catch(() => "unsupported" as const);
      if (cancelled) return;

      const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
      const warm = shouldWarmUpWasm({
        supported: readiness !== "unsupported",
        readiness,
        loaded: isTranscriberLoaded(),
        saveData: connection?.saveData === true,
      });
      if (!warm) return;

      await warmTranscriber();
    };

    /* 最初の描画とぶつけない。対応端末では idle を待つ */
    const idle = (globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    const timer = setTimeout(() => {
      if (typeof idle === "function") {
        idle(() => void run(), { timeout: 5_000 });
      } else {
        void run();
      }
    }, 1_500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  /* 何も描かない */
  return null;
}
