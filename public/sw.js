/**
 * 単語音声のオフラインキャッシュ — issue #84
 *
 * 目的は「電波が無くても カードの よみあげが 鳴る」ことだけ。
 * **`/audio/` 以外には一切干渉しない** (Next の資産や API のキャッシュ戦略は
 * ここでは触らない)。アプリ本体のオフライン化は別の話として扱う。
 *
 * - install: `index.json` に並ぶ音声をまとめて取る (失敗しても install は続ける)
 * - fetch: キャッシュ優先。裏で取り直して更新する (stale-while-revalidate)
 *
 * パスの規則は `src/lib/audio/audio-assets.ts` と揃えること。
 */

const CACHE_NAME = "efk-word-audio-v1";
const AUDIO_PREFIX = "/audio/";
const INDEX_URL = "/audio/words/index.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const response = await fetch(INDEX_URL, { cache: "no-cache" });
        if (response.ok) {
          const urls = await response.json();
          if (Array.isArray(urls)) {
            // 1 つ失敗しても他は残す (install を落とすと SW 自体が入らない)
            await Promise.allSettled(urls.map((url) => cache.add(url)));
          }
        }
      } catch {
        /* オフラインで install された場合は、再生のたびに貯める */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("efk-word-audio-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(AUDIO_PREFIX)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      if (cached) {
        // 裏で更新 (次の再生から新しいファイルになる)。失敗は無視する。
        fetch(request)
          .then((response) => {
            if (response.ok) return cache.put(request, response.clone());
            return undefined;
          })
          .catch(() => undefined);
        return cached;
      }

      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
