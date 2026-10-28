"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MODEL_CACHE_NAME,
  MODEL_FILE_NAMES,
  MODEL_SIZE_BYTES,
  ModelCacheError,
  clearModelCache,
  ensureModels,
  isModelReady,
  loadVerifiedFiles,
  type ModelErrorKind,
} from "@/lib/speech/model-cache";
import { modelUrl } from "@/lib/speech/model-origin";
import { MODEL_FILES, type ModelFileName } from "@/lib/speech/model-manifest";

/**
 * モデルキャッシュの手動確認パネル (開発専用)。
 * 破壊的操作 (改ざん・削除) をボタンで起こせるようにして、検出と復旧を目で見る。
 */

type Status = {
  ready: boolean;
  caches: { name: string; entries: number }[];
};

export default function ModelCheckPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [busy, setBusy] = useState(false);

  const note = useCallback((message: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    const ready = await isModelReady();
    const names = "caches" in globalThis ? await caches.keys() : [];
    const cachesInfo = [];
    for (const name of names.filter((n) => n.startsWith("moonshine-models-"))) {
      const cache = await caches.open(name);
      cachesInfo.push({ name, entries: (await cache.keys()).length });
    }
    setStatus({ ready, caches: cachesInfo });
  }, []);

  useEffect(() => {
    // 初期状態の読み込み。開発専用の確認パネルなので、この 1 箇所だけ許可する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const describe = (error: unknown) => {
    if (error instanceof ModelCacheError) {
      const cause = error.cause instanceof Error ? ` / cause: ${error.cause.name}: ${error.cause.message}` : "";
      return `${error.kind}${error.file ? ` (${error.file})` : ""}: ${error.message}${cause}`;
    }
    return String(error);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      const kind: ModelErrorKind | "unknown" =
        error instanceof ModelCacheError ? error.kind : "unknown";
      note(`${label}: NG [${kind}] ${describe(error)}`);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const download = () =>
    run("download", async () => {
      setLoaded(0);
      note(`download 開始 (合計 ${MODEL_SIZE_BYTES.toLocaleString()} bytes)`);
      await ensureModels({
        onProgress: (p) => setLoaded(p.loaded),
      });
      note("download 完了 (検証済み・昇格済み)");
    });

  const verify = () =>
    run("verify", async () => {
      const files = await loadVerifiedFiles();
      const bytes = [...files.values()].reduce((a, b) => a + b.byteLength, 0);
      note(`verify: OK ${files.size} ファイル / ${bytes.toLocaleString()} bytes`);
    });

  const corrupt = () =>
    run("corrupt", async () => {
      const cache = await caches.open(MODEL_CACHE_NAME);
      // 一番小さいファイルを壊す (大きいものを書き戻すと、容量の厳しい環境で
      // それ自体が QuotaExceededError になる)
      const name = MODEL_FILE_NAMES.reduce((a: ModelFileName, b: ModelFileName) =>
        MODEL_FILES[a].bytes <= MODEL_FILES[b].bytes ? a : b,
      );
      const hit = await cache.match(modelUrl(name));
      if (!hit) throw new Error(`${name} がキャッシュにありません`);
      const bytes = new Uint8Array(await hit.arrayBuffer());
      bytes[bytes.length - 1] ^= 0xff; // 1 バイトだけ壊す
      await cache.put(modelUrl(name), new Response(bytes));
      note(`${name} の末尾 1 バイトを破壊しました (sentinel は残す → ready のまま)`);
    });

  const dropOne = () =>
    run("drop", async () => {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const name = MODEL_FILE_NAMES[1];
      const deleted = await cache.delete(modelUrl(name));
      note(`${name} を削除: ${deleted ? "成功" : "無かった"}`);
    });

  const wipe = () =>
    run("wipe", async () => {
      await clearModelCache();
      note("キャッシュを全消去しました");
    });

  const pct = status ? Math.floor((loaded / MODEL_SIZE_BYTES) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-2xl p-6 text-sm">
      <h1 className="mb-4 text-lg font-bold">モデルキャッシュ確認 (開発専用)</h1>

      <section className="mb-4 rounded border border-gray-300 p-3">
        <div>
          状態: <strong>{status ? (status.ready ? "ready" : "absent") : "…"}</strong>
        </div>
        <div className="mt-1 text-xs text-gray-600">cache: {MODEL_CACHE_NAME}</div>
        <div className="mt-1 text-xs text-gray-600">
          進捗: {loaded.toLocaleString()} / {MODEL_SIZE_BYTES.toLocaleString()} ({pct}%)
        </div>
        <ul className="mt-2 text-xs text-gray-700">
          {status?.caches.map((c) => (
            <li key={c.name}>
              {c.name} … {c.entries} entries
            </li>
          ))}
          {status && status.caches.length === 0 && <li>キャッシュなし</li>}
        </ul>
      </section>

      <section className="mb-4 flex flex-wrap gap-2">
        {[
          ["ダウンロード", download],
          ["読み出して検証", verify],
          ["1バイト改ざん", corrupt],
          ["1ファイル削除", dropOne],
          ["全消去", wipe],
          ["再読込", async () => refresh()],
        ].map(([label, fn]) => (
          <button
            key={label as string}
            type="button"
            disabled={busy}
            onClick={() => void (fn as () => Promise<void>)()}
            className="rounded border border-gray-400 px-3 py-1 disabled:opacity-40"
          >
            {label as string}
          </button>
        ))}
      </section>

      <section className="rounded border border-gray-300 p-3">
        <pre className="whitespace-pre-wrap font-mono text-xs">{log.join("\n") || "(ログなし)"}</pre>
      </section>
    </main>
  );
}
