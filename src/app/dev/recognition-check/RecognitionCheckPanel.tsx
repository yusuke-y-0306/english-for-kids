"use client";

import { useCallback, useEffect, useState } from "react";
import PrivacyNotice from "@/components/speech/PrivacyNotice";
import RecognitionPathBadge from "@/components/speech/RecognitionPathBadge";
import SelfReportPrompt from "@/components/speech/SelfReportPrompt";
import {
  DeviceRecognitionError,
  createDeviceRecognizer,
  listenOnce,
  resolveRecognitionDecision,
  type RecognitionDecision,
} from "@/lib/speech/device-recognition";

/**
 * 認識経路の手動確認パネル (開発専用)。
 * e2e から読めるように、結果は `<pre id="report">` に key=value で出す。
 */

export default function RecognitionCheckPanel() {
  const [decision, setDecision] = useState<RecognitionDecision | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [result, setResult] = useState("-");
  const [selfReported, setSelfReported] = useState<string | null>(null);

  const detect = useCallback(async () => {
    const next = await resolveRecognitionDecision(wasmReady);
    setDecision(next);
    setResult("-");
  }, [wasmReady]);

  useEffect(() => {
    // 開発専用パネルの初期表示。この 1 箇所だけ許可する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detect();
  }, [detect]);

  const listen = async () => {
    if (!decision) return;
    try {
      // decision.path !== "device" ならここで例外になる (インスタンスは作られない)
      const recognizer = createDeviceRecognizer(decision);
      const out = await listenOnce(recognizer, 5000);
      setResult(`ok: ${out.transcript}`);
    } catch (error) {
      if (error instanceof DeviceRecognitionError) {
        const failure = error.failure;
        setResult(
          failure.kind === "failed"
            ? `error: failed:${failure.code}`
            : failure.kind === "not-local"
              ? `error: not-local:${failure.reason}`
              : `error: ${failure.kind}`,
        );
      } else {
        setResult(`error: ${String(error)}`);
      }
    }
  };

  const report = decision?.report;
  const reportText = [
    `path=${decision?.path ?? "?"}`,
    `reason=${decision?.reason ?? ""}`,
    `present=${report?.present ?? "?"}`,
    `hasProcessLocally=${report?.hasProcessLocally ?? "?"}`,
    `availability=${report?.availability ?? "none"}`,
    `result=${result}`,
  ].join("\n");

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6 text-sm">
      <h1 className="text-lg font-bold">認識経路の確認 (開発専用)</h1>

      <PrivacyNotice />

      <section className="rounded border border-gray-300 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span>経路:</span>
          {decision ? <RecognitionPathBadge path={decision.path} /> : <span>…</span>}
          <span className="text-xs text-gray-600">{decision?.reason}</span>
        </div>
        <pre id="report" className="whitespace-pre-wrap font-mono text-xs">
          {reportText}
        </pre>
      </section>

      <section className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void detect()} className="rounded border border-gray-400 px-3 py-1">
          再検出
        </button>
        <button type="button" onClick={() => void listen()} className="rounded border border-gray-400 px-3 py-1">
          1回認識
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={wasmReady}
            onChange={(event) => setWasmReady(event.target.checked)}
          />
          wasm モデルが準備済み (経路判定の確認用)
        </label>
      </section>

      <section>
        <p className="mb-1 text-xs text-gray-600">自己申告モードの見本:</p>
        <SelfReportPrompt word="elephant" onAnswer={(said) => setSelfReported(said ? "いえた" : "もういちど")} />
        {selfReported && <p className="mt-1 text-xs">自己申告: {selfReported}</p>}
      </section>
    </main>
  );
}
