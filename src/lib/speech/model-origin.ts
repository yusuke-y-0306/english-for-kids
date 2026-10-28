import { MODEL_FILES, MODEL_PATH_PREFIX, type ModelFileName } from "./model-manifest";

/**
 * モデルの配信元 — issue #30 (案 A: アプリとは別オリジン)
 *
 * なぜ別オリジンなのか:
 *  - モデルは Cache Storage に 50MB 単位で永続化され、同一オリジンの JS から書き換えられる。
 *    アプリと同一オリジンに置くと、XSS 一つで「セッションと同じ信頼境界」のままモデルを
 *    差し替えられてしまう。配信オリジンを分けておけば、汚染が及ぶ範囲をモデルに閉じ込められる。
 *  - 41MB のバイナリをリポジトリ (main) に置かないため、git 履歴の汚染も避けられる。
 *
 * ここはコードに固定した定数であること。環境変数・クエリパラメータ・props など、
 * 外部から差し替えられる経路を作らない (実行時に URL を組み立てない)。
 * 差し替えは必ずこのファイルの変更 = レビューを通す。
 */

/** 本番の配信元 (GitHub Pages / gh-pages ブランチ)。詳細は docs/speech-model-hosting.md */
const PRODUCTION_ORIGIN = "https://yusuke-y-0306.github.io/english-for-kids";

/** 開発時の配信元 (`node scripts/models.mjs serve` が立てる) */
const DEVELOPMENT_ORIGIN = "http://127.0.0.1:3101";

export const MODEL_ORIGIN =
  process.env.NODE_ENV === "development" ? DEVELOPMENT_ORIGIN : PRODUCTION_ORIGIN;

/**
 * モデルファイルの絶対 URL。
 * manifest に載っているファイル名しか受け付けない (fail closed)。
 */
export function modelUrl(name: ModelFileName): string {
  if (!Object.prototype.hasOwnProperty.call(MODEL_FILES, name)) {
    throw new Error(`未知のモデルファイルです: ${String(name)}`);
  }
  return `${MODEL_ORIGIN}/${MODEL_PATH_PREFIX}/${name}`;
}

/** manifest の全ファイル分の URL (読み込み時に一括で渡す用) */
export function allModelUrls(): Record<ModelFileName, string> {
  const entries = Object.keys(MODEL_FILES).map((name) => [
    name,
    modelUrl(name as ModelFileName),
  ]);
  return Object.fromEntries(entries) as Record<ModelFileName, string>;
}
