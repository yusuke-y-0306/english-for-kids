/**
 * node --test で src/lib/quiz.ts を読み込むための小さな解決フック。
 * quiz.ts は Next.js 向けに `./words` のように拡張子なしで import しているので、
 * 相対指定子に .ts を補ってから解決し直す。
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw e;
  }
}
