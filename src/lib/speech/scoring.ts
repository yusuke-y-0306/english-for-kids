import type { PronunciationScore } from "./scores";

/**
 * 発音の判定 — issue #2
 *
 * 端末内で認識したテキストと、お手本の単語を比べて 3 段階に落とす。
 * ここは**純粋関数だけ**にして、単体テストで仕様を固定する
 * (音声もブラウザ API も触らないので、Node のテストで検証できる)。
 *
 * 判定の方針:
 *  - 子どもの発音は「聞き取れれば御の字」。厳しく減点しない。
 *  - 余分な冠詞や前置詞 ("a dog") は許す → 単語列の**窓**で一致を見る。
 *  - 完全一致 → `ok` / 少し違う → `close` / それ以上 → `retry`。
 */

export type ScoreResult = {
  score: PronunciationScore;
  /** お手本との編集距離 (文字単位・最小値)。0 なら一致 */
  distance: number;
  /** 画面にそのまま出せる短いヒント */
  hint: string;
};

/**
 * お手本以外に「言えていれば正解」とみなす語 (issue #40)。
 *
 * 認識エンジンは**音**を文字に落とすので、綴りが違うだけの語を返すことがある
 * (two → "Too," / eye → "I")。これを retry にすると「言えたのに もういちど」になり、
 * この機能で一番やってはいけない誤検出になる。だから採点側で吸収する。
 *
 * `homophones` は**同じ音**なので ok。`variants` は**別の語**なので close 止まり。
 * 「mother と言うべきところで mom と言っても満点」にはしない、という線引き。
 */
export type ScoreOptions = {
  /** 同音で綴りが違う語 (two → too/to, eye → I)。当たれば ok */
  homophones?: string[];
  /** 意味は同じだが別の語 (mother → mom)。当たっても ok にはせず close 止まり */
  variants?: string[];
};

/** 比較用に文字列をならす (小文字化・記号除去・空白圧縮) */
export function normalizeTranscript(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 文字単位のレーベンシュタイン距離 (単語は数十文字なので素朴な DP で足りる) */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * お手本との最小距離。
 * 単語数が違う ("a dog" 対 "dog") ケースを拾うため、同じ長さの窓だけを比べる。
 */
function bestDistance(transcriptTokens: string[], targetTokens: string[]): number {
  const target = targetTokens.join(" ");
  if (transcriptTokens.length === 0) return target.length;
  const width = Math.max(1, targetTokens.length);
  if (transcriptTokens.length <= width) {
    return levenshtein(transcriptTokens.join(" "), target);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + width <= transcriptTokens.length; i += 1) {
    best = Math.min(best, levenshtein(transcriptTokens.slice(i, i + width).join(" "), target));
    if (best === 0) break;
  }
  return best;
}

/** 聞き取れたテキストをお手本と比べる */
export function scorePronunciation(
  transcript: string,
  target: string,
  options: ScoreOptions = {},
): ScoreResult {
  const said = normalizeTranscript(transcript);
  const expected = normalizeTranscript(target);
  const expectedTokens = expected ? expected.split(" ") : [];

  if (!expected) {
    return { score: "retry", distance: Number.POSITIVE_INFINITY, hint: "お手本が ありません" };
  }
  if (!said) {
    return { score: "retry", distance: expected.length, hint: "よく きこえなかったよ" };
  }

  const saidTokens = said.split(" ");
  const distance = bestDistance(saidTokens, expectedTokens);
  // 許容幅は文字数の 3 分の 1 (最低 1)。"dog" なら 1 文字までは close。
  const tolerance = Math.max(1, Math.floor(expected.length / 3));

  if (distance === 0) {
    return { score: "ok", distance, hint: "ばっちり！" };
  }

  // 同音の別綴り (two → "Too") は ok。音が同じなので言えている
  if (matchesAny(saidTokens, options.homophones)) {
    return { score: "ok", distance: 0, hint: "ばっちり！" };
  }

  // 同じ意味の別の語 (mother → "Mom") は close 止まり。お手本の語とは違うので満点にしない
  if (matchesAny(saidTokens, options.variants)) {
    return { score: "close", distance: 0, hint: "おしい！もういちど いってみよう" };
  }

  if (distance <= tolerance) {
    return { score: "close", distance, hint: "おしい！もういちど いってみよう" };
  }
  return { score: "retry", distance, hint: "ゆっくり はっきり いってみよう" };
}

/**
 * 候補のどれかと完全一致したか。候補が無ければ false なので、今までどおりの採点になる。
 * 候補も `normalizeTranscript` を通す ("I" と "i" を同じにするため)。
 */
function matchesAny(saidTokens: string[], candidates?: string[]): boolean {
  for (const candidate of candidates ?? []) {
    const tokens = normalizeTranscript(candidate).split(" ").filter(Boolean);
    if (tokens.length && bestDistance(saidTokens, tokens) === 0) return true;
  }
  return false;
}
