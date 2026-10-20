/**
 * GrammarChecker — 単語の並びが「英文として文法的に正しいか」を判定する。
 *
 * 仕組み:
 *  1. タスクごとに用意した文法パターン（文の骨組み）に、単語列を当てはめてみる。
 *     当てはまれば「その文型として成立している」= 文法的に正しい。
 *  2. 当てはまったうえで、主語と be 動詞の一致 / a・an の使い分けを検査する。
 *  3. 文法的に作れる文を列挙する機能（`enumerate`）も持ち、
 *     「語順だけ違う」を判定するのに使う。
 *
 * なぜパターンか:
 *   カードは各タスクの語彙に限定されているので、汎用の自然言語パーサを持ち込むより、
 *   タスクごとの文型 × 語彙スロットのほうが正確で、説明もしやすい。
 */

import type {
  GrammarIssue,
  GrammarPattern,
  GrammarResult,
  SlotValues,
} from "./types";

/** `<subject>` のようなスロット参照 */
const SLOT_RE = /^<([a-z0-9_]+)>$/;

/** 主語 → 使える be 動詞 */
const BE_BY_SUBJECT: Record<string, string[]> = {
  i: ["am"],
  you: ["are"],
  we: ["are"],
  they: ["are"],
  he: ["is"],
  she: ["is"],
  it: ["is"],
};

const ARTICLES = new Set(["a", "an"]);

/** 母音で始まる綴りか（a / an の判定用の簡易ヒューリスティック） */
function startsWithVowelSound(word: string): boolean {
  return /^[aeiou]/i.test(word);
}

/** スロット値を「語句の配列」に正規化する */
function toPhrases(values: SlotValues): string[][] {
  if (values.length === 0) return [];
  return Array.isArray(values[0])
    ? (values as string[][])
    : (values as string[]).map((w) => [w]);
}

/** 比較用の正規化（大文字小文字・句読点を無視する） */
function canon(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function sameWord(a: string, b: string): boolean {
  return canon(a) === canon(b);
}

export class GrammarChecker {
  private readonly patterns: GrammarPattern[];

  constructor(patterns: GrammarPattern[]) {
    this.patterns = patterns;
  }

  /**
   * 単語列が文法パターンのいずれかに合致するか判定する。
   * 合致しても文法ルール違反があれば `ok: false` と `issue` を返す。
   */
  check(tokens: string[]): GrammarResult {
    // 構造としては当てはまったが文法ルールで落ちたもの（a/an など）を覚えておく
    let firstIssue: GrammarIssue | null = null;

    for (const pattern of this.patterns) {
      const binds = this.matchPattern(pattern, tokens);
      if (!binds) continue;

      const issue = this.validate(pattern, binds);
      if (!issue) return { ok: true, patternId: pattern.id };
      if (!firstIssue) firstIssue = issue;
    }

    return { ok: false, issue: firstIssue };
  }

  /** 文法パターンから作れる文を列挙する（順序違いの判定・テスト用） */
  enumerate(limit = 2000): string[][] {
    const out: string[][] = [];
    for (const pattern of this.patterns) {
      this.expand(pattern, 0, [], new Map(), out, limit);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * 語順だけが違う（使う単語の組み合わせは合っている）候補を返す。
   * 見つからなければ null。
   */
  findOrderHint(tokens: string[]): string[] | null {
    const target = tokens.map(canon).sort();
    for (const candidate of this.enumerate()) {
      const sorted = candidate.map(canon).sort();
      if (sorted.length !== target.length) continue;
      if (sorted.every((w, i) => w === target[i])) return candidate;
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * 内部: パターンマッチング
   * ---------------------------------------------------------------- */

  private matchPattern(
    pattern: GrammarPattern,
    tokens: string[],
  ): Map<string, string[]> | null {
    return this.matchFrom(pattern, tokens, 0, 0, new Map());
  }

  private matchFrom(
    pattern: GrammarPattern,
    tokens: string[],
    patternIdx: number,
    tokenIdx: number,
    binds: Map<string, string[]>,
  ): Map<string, string[]> | null {
    // パターンを使い切ったら、単語も使い切っていること
    if (patternIdx === pattern.tokens.length) {
      return tokenIdx === tokens.length ? binds : null;
    }

    const token = pattern.tokens[patternIdx];
    const slotMatch = SLOT_RE.exec(token);

    // リテラル
    if (!slotMatch) {
      if (tokenIdx >= tokens.length) return null;
      if (!sameWord(tokens[tokenIdx], token)) return null;
      return this.matchFrom(pattern, tokens, patternIdx + 1, tokenIdx + 1, binds);
    }

    // スロット
    const slotName = slotMatch[1];
    const values = pattern.slots[slotName];
    if (!values) return null;

    for (const phrase of toPhrases(values)) {
      if (phrase.length > tokens.length - tokenIdx) continue;
      const hit = phrase.every((p, k) => sameWord(tokens[tokenIdx + k], p));
      if (!hit) continue;

      const nextBinds = new Map(binds);
      nextBinds.set(slotName, phrase);
      const result = this.matchFrom(
        pattern,
        tokens,
        patternIdx + 1,
        tokenIdx + phrase.length,
        nextBinds,
      );
      if (result) return result;
    }

    return null;
  }

  /* ---------------------------------------------------------------- *
   * 内部: 文法ルール
   * ---------------------------------------------------------------- */

  private validate(
    pattern: GrammarPattern,
    binds: Map<string, string[]>,
  ): GrammarIssue | null {
    return this.agreementIssue(binds) ?? this.articleIssue(pattern, binds);
  }

  /** 主語と be 動詞の一致（I am / you are / it is ...） */
  private agreementIssue(binds: Map<string, string[]>): GrammarIssue | null {
    const subject = binds.get("subject")?.[0];
    const be = binds.get("be")?.[0];
    if (!subject || !be) return null;

    const allowed = BE_BY_SUBJECT[subject.toLowerCase()];
    if (!allowed) return null;
    if (allowed.includes(be.toLowerCase())) return null;

    return {
      rule: "agreement",
      message: `「${subject}」のあとは「${allowed[0]}」だよ`,
    };
  }

  /**
   * a / an の使い分け。
   * 冠詞の直後の語が母音で始まるなら an、そうでなければ a。
   */
  private articleIssue(
    pattern: GrammarPattern,
    binds: Map<string, string[]>,
  ): GrammarIssue | null {
    const articlePos = pattern.tokens.indexOf("<article>");
    if (articlePos < 0) return null;

    const article = binds.get("article")?.[0];
    if (!article || !ARTICLES.has(article.toLowerCase())) return null;

    // 冠詞のすぐ次の語（リテラル or スロットの先頭語）
    const nextToken = pattern.tokens[articlePos + 1];
    if (!nextToken) return null;

    const nextSlot = SLOT_RE.exec(nextToken);
    const followingWord = nextSlot
      ? binds.get(nextSlot[1])?.[0]
      : nextToken;
    if (!followingWord) return null;

    // 次がスロットの後続語（例: <article> <adj> <animal> の adj）でも
    // 英語の a/an は「直後の語」で決まるので、そのままで正しい。
    const expected = startsWithVowelSound(followingWord) ? "an" : "a";
    if (article.toLowerCase() === expected) return null;

    return {
      rule: "article" as const,
      message: `「${followingWord}」のまえは「${expected}」だよ`,
    };
  }

  /* ---------------------------------------------------------------- *
   * 内部: 文の列挙
   * ---------------------------------------------------------------- */

  private expand(
    pattern: GrammarPattern,
    patternIdx: number,
    acc: string[],
    binds: Map<string, string[]>,
    out: string[][],
    limit: number,
  ): void {
    if (out.length >= limit) return;

    if (patternIdx === pattern.tokens.length) {
      // 文法ルール（a/an、主語と be の一致）に反する文は列挙しない
      if (this.validate(pattern, binds)) return;
      out.push(acc);
      return;
    }

    const token = pattern.tokens[patternIdx];
    const slotMatch = SLOT_RE.exec(token);

    if (!slotMatch) {
      this.expand(pattern, patternIdx + 1, [...acc, token], binds, out, limit);
      return;
    }

    const values = pattern.slots[slotMatch[1]];
    if (!values) return;
    for (const phrase of toPhrases(values)) {
      const nextBinds = new Map(binds);
      nextBinds.set(slotMatch[1], phrase);
      this.expand(
        pattern,
        patternIdx + 1,
        [...acc, ...phrase],
        nextBinds,
        out,
        limit,
      );
      if (out.length >= limit) return;
    }
  }
}
