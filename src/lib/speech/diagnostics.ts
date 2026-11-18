/**
 * 端末内推論が「なぜ終わらないか」を切り分けるための最小の計測 — issue #2
 *
 * iPhone Safari で「モデルを よみこみ中…」から進まない報告があった。
 * 疑わしいのは
 *   1. pthread の Worker が立ち上がらない (Emscripten の初期化で待ち続ける)
 *   2. wasm のコンパイルが極端に遅い
 *   3. ONNX Runtime のセッション構築が終わらない
 * のどれか。画面から切り分けられるように、**Worker が動くか**と**環境の値**だけを見る。
 *
 * ここは表示のためだけの補助で、判断 (経路選択) には使わない。
 */

export type SpeechDiagnostics = {
  /** cross-origin isolation (SharedArrayBuffer の前提) */
  isolated: boolean;
  /** SharedArrayBuffer が使えるか */
  sharedArrayBuffer: boolean;
  /** 論理コア数 (pthread のプール数) */
  cores: number;
  /**
   * モジュール Worker を 1 つ起動して往復できた時間 (ms)。だめなら null。
   * wasm は読み込まないので、Worker 自体が使えるかだけを見る。
   */
  workerMs: number | null;
};

const WORKER_TEST_TIMEOUT_MS = 5_000;

/** モジュール Worker が使えるかを実測する (結果は表示用) */
async function measureWorker(): Promise<number | null> {
  if (typeof Worker !== "function") return null;
  const source = "self.postMessage('ok');";
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const started = performance.now();
  try {
    return await new Promise<number | null>((resolve) => {
      const worker = new Worker(url, { type: "module" });
      const timer = setTimeout(() => resolve(null), WORKER_TEST_TIMEOUT_MS);
      worker.onmessage = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(Math.round(performance.now() - started));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(null);
      };
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 画面に出すための計測 (副作用あり・失敗しない) */
export async function collectSpeechDiagnostics(): Promise<SpeechDiagnostics> {
  const scope = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    SharedArrayBuffer?: unknown;
    navigator?: { hardwareConcurrency?: number };
  };
  return {
    isolated: scope.crossOriginIsolated === true,
    sharedArrayBuffer: typeof scope.SharedArrayBuffer === "function",
    cores: scope.navigator?.hardwareConcurrency ?? 0,
    workerMs: await measureWorker(),
  };
}

/** 1 行の要約 (保護者が読み上げられる長さ) */
export function describeSpeechDiagnostics(diagnostics: SpeechDiagnostics): string {
  const worker =
    diagnostics.workerMs === null ? "Worker だめ" : `Worker OK (${diagnostics.workerMs}ms)`;
  return `${diagnostics.cores}コア / きょうゆうメモリ ${
    diagnostics.sharedArrayBuffer ? "あり" : "なし"
  } / こりつ ${diagnostics.isolated ? "あり" : "なし"} / ${worker}`;
}
