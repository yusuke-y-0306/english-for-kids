/**
 * `node --test` から `src/lib/quiz.ts` を読み込むための小さな解決フック。
 *
 * quiz.ts は Next.js（moduleResolution: "bundler"）向けに `./words` のように
 * 拡張子なしで import している。Node の型ストリッピングは拡張子を補わないので、
 * 相対指定子の解決に失敗したときだけ `.ts` を足して引き直す。
 * アプリ側の import 文には手を入れない（バンドラの挙動を変えない）。
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith(".");
    const hasExtension = /\.[cm]?[jt]s$/.test(specifier);
    if (!relative || hasExtension) throw error;
    return next(`${specifier}.ts`, context);
  }
}
