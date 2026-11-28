/**
 * クイズ・ゲーム機能のデータ — issue #3
 *
 * 設計方針:
 * - 1ラウンド = 8問。レベルは 4つ（きいて えらぶ / はじめて / ちゅうきゅう / じょうきゅう）。
 * - リスニングと初級は `words.ts` の単語から毎回ランダムに出題する（同じ単語でも、
 *   選択肢と順番が変わるので繰り返し遊べる）。
 * - 中級・上級は固定の問題プールからランダムに8問を抜き出す。
 * - 問題の生成はクライアントの「スタート」押下時だけ行う。
 *   （SSR 時に Math.random を走らせるとハイドレーションがズレるため）
 */

import { categories, playCategories, type Word } from "./words";

export type QuizLevelId = "listening" | "beginner" | "intermediate" | "advanced";

export type QuizQuestion = {
  id: string;
  /**
   * 出題した単語の ID (`animals/dog` 形式)。進捗の記録 (#76) に使う。
   * 中級・上級の文法問題は単語に紐づかないので **持たない**。
   */
  wordId?: string;
  /** 大きく見せる絵文字（初級のみ） */
  display?: string;
  /** 問題文（英語。中級・上級で使う） */
  promptEn?: string;
  /** 問題文（日本語） */
  promptJa: string;
  /** 4つの選択肢 */
  choices: string[];
  /**
   * 絵で答える問題（リスニング #85）の選択肢。`choices` と同じ並びの絵文字。
   *
   * これがある問題は「音 → 絵」で解く問題で、文字は補助でしかない。
   * 画面側はこの配列の有無で描き分ける（`wordId` の単語を出題時に読み上げる）。
   */
  pictures?: string[];
  /** 正解の index */
  answer: number;
  /** 答え合わせのときに出すやさしい説明 */
  explanation: string;
};

export type QuizLevel = {
  id: QuizLevelId;
  label: string;
  en: string;
  emoji: string;
  desc: string;
  /** カードの背景色（hex） */
  color: string;
  ink: string;
};

export const QUIZ_LENGTH = 8;

export const quizLevels: QuizLevel[] = [
  {
    id: "listening",
    label: "きいて えらぶ",
    en: "Listening",
    emoji: "👂",
    desc: "おとを きいて、えを えらぼう。",
    color: "#e6f3ff",
    ink: "#1f5f8b",
  },
  {
    id: "beginner",
    label: "はじめて",
    en: "Beginner",
    emoji: "🌱",
    desc: "たんごの いみが わかるかな？",
    color: "#eef7e2",
    ink: "#38702f",
  },
  {
    id: "intermediate",
    label: "ちゅうきゅう",
    en: "Intermediate",
    emoji: "🌻",
    desc: "ぶんに あう ことばを えらぼう。",
    color: "#fff3d6",
    ink: "#a85f08",
  },
  {
    id: "advanced",
    label: "じょうきゅう",
    en: "Advanced",
    emoji: "🚀",
    desc: "ぶんぽうに ちょうせん！",
    color: "#e6f6ff",
    ink: "#1a6f95",
  },
];

/**
 * 外部入力（API のボディなど）がレベルの ID かどうか。
 * `quizLevels` を唯一の正とし、増やしたときに検証側を直し忘れないようにする。
 */
export function isQuizLevelId(value: unknown): value is QuizLevelId {
  return quizLevels.some((level) => level.id === value);
}

/* ------------------------------------------------------------------ *
 * ユーティリティ
 * ------------------------------------------------------------------ */

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueByEn<T extends { en: string }>(words: T[]): T[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    if (seen.has(w.en)) return false;
    seen.add(w.en);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * リスニング — 音をきいて絵を選ぶ（#85）
 * ------------------------------------------------------------------ */

/**
 * 絵で答えられるカテゴリだけを使う。
 *
 * 前置詞・形容詞・動詞・数詞は、絵だけでは語を一意に決められない
 * （`in` と `on` の絵、`big` の絵、`sit` の絵…）。未就学児が
 * 「音 → 意味（絵）」を学ぶ入口なので、具体名詞に絞る。
 */
const LISTENING_CATEGORY_IDS = [
  "animals",
  "food",
  "clothes",
  "vehicles",
  "home",
  "school",
  "sports",
  "body",
  "family",
] as const;

/**
 * 絵が語を表していない（別の意味に見える）単語は出さない。
 * 誤答の絵と紛れると「聞き取れたのに間違い」になるため、迷わず外す。
 */
const LISTENING_EXCLUDED_IDS = new Set([
  "body/head", // 🗣️ は「話す」の絵に見える
  "home/table", // 🍽️ は「食べる」の絵に見える
  "school/desk", // 🗄️ は書庫の絵
  "sports/team", // 👥 は「人たち」で、単語の意味にならない
]);

/** リスニングで使える単語（具体名詞のみ）。 */
function listeningWords(): Word[] {
  return categories
    .filter((category) =>
      (LISTENING_CATEGORY_IDS as readonly string[]).includes(category.id),
    )
    .flatMap((category) => category.words)
    .filter(
      (word) =>
        word.pos === "noun" &&
        word.emoji.length > 0 &&
        !LISTENING_EXCLUDED_IDS.has(word.id),
    );
}

function buildListeningQuestions(count: number): QuizQuestion[] {
  const pool = uniqueByEn(listeningWords());
  const picked = shuffle(pool).slice(0, count);

  return picked.map((word, i) => {
    const categoryId = word.id.split("/")[0];
    /* 同じ絵・同じ意味の語をダミーにすると、正解が 2 つに見える */
    const candidates = pool.filter(
      (w) => w.id !== word.id && w.ja !== word.ja && w.emoji !== word.emoji,
    );
    const sameCategory = candidates.filter((w) => w.id.startsWith(`${categoryId}/`));

    /* 絵が重なると選択肢が 2 つに見えるので、絵文字も一意にする */
    const distractors: Word[] = [];
    const usedEmoji = new Set([word.emoji]);
    for (const candidate of [...shuffle(sameCategory), ...shuffle(candidates)]) {
      if (distractors.length >= 3) break;
      if (usedEmoji.has(candidate.emoji)) continue;
      usedEmoji.add(candidate.emoji);
      distractors.push(candidate);
    }
    if (distractors.length < 3) {
      throw new Error(`listening quiz: ダミーが足りません (${word.id})`);
    }

    const options = shuffle([word, ...distractors]);

    return {
      id: `listening-${i}-${word.en}`,
      // 進捗キーはコンテンツ側の不変 ID (#83)。`en` から組み立てない。
      wordId: word.id,
      promptJa: "おとを きいて、えを えらぼう。",
      choices: options.map((w) => w.en),
      // 正解の位置は options の並び替えで決まる（index を固定しない）
      pictures: options.map((w) => w.emoji),
      answer: options.indexOf(word),
      explanation: `“${word.en}” は「${word.ja}」だよ。`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 初級 — 単語当て（words.ts から生成）
 * ------------------------------------------------------------------ */

function buildBeginnerQuestions(count: number): QuizQuestion[] {
  /* #88: アルファベットと word family は専用の練習画面で扱うので出題しない */
  const all = playCategories.flatMap((c) =>
    c.words.map((w) => ({ ...w, categoryId: c.id })),
  );
  /* サイトワードは既存カテゴリと綴りが重なる (big / red …)。
     同じ語が 1 ラウンドに 2 回出ないよう、出題側で畳む (#87) */
  const picked = shuffle(uniqueByEn(all)).slice(0, count);

  return picked.map((word, i) => {
    const category = playCategories.find((c) => c.id === word.categoryId);
    const sameCategory = uniqueByEn(
      (category?.words ?? []).filter((w) => w.en !== word.en),
    );
    const otherCategories = uniqueByEn(
      all.filter((w) => w.categoryId !== word.categoryId && w.en !== word.en),
    );

    // 同じカテゴリの単語を優先。足りなければ他のカテゴリから補う。
    const distractors: Word[] = shuffle(sameCategory).slice(0, 3);
    if (distractors.length < 3) {
      for (const w of shuffle(otherCategories)) {
        if (distractors.length >= 3) break;
        if (distractors.some((d) => d.en === w.en)) continue;
        distractors.push(w);
      }
    }

    const choices = shuffle([word, ...distractors].map((w) => w.en));

    return {
      id: `beginner-${i}-${word.en}`,
      // 進捗キーはコンテンツ側の不変 ID (#83)。`en` から組み立てない。
      wordId: word.id,
      display: word.emoji,
      promptJa: `「${word.ja}」は えいごで なに？`,
      choices,
      answer: choices.indexOf(word.en),
      explanation: `${word.ja} は えいごで “${word.en}” だよ。`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 中級 — 文に合うことば
 * ------------------------------------------------------------------ */

/**
 * 中級・上級のプールに置く 1 問 — issue #82
 *
 * `QuizQuestion` は採点のため正解を **index** で持つが、プールのデータで
 * index を持つと「正解は必ず choices[0]」という並び順への依存が生まれる
 * （実際に 24 問すべて `answer: 0` で、解く側からは常に A が正解に見えた）。
 * ここでは正解を **文字列** で持ち、出題時に並べ替えた後の位置を引き直す。
 */
type QuizPoolEntry = Omit<QuizQuestion, "id" | "answer"> & { answer: string };

const intermediatePool: QuizPoolEntry[] = [
  {
    promptEn: "I ___ a dog.",
    promptJa: "わたしは いぬを かっているよ。",
    choices: ["have", "has", "am", "is"],
    answer: "have",
    explanation: "「わたし」は I。I の ときは have を つかうよ。",
  },
  {
    promptEn: "She ___ a teacher.",
    promptJa: "かのじょは せんせいです。",
    choices: ["is", "are", "am", "be"],
    answer: "is",
    explanation: "she（かのじょ）は ひとり。だから is だよ。",
  },
  {
    promptEn: "___ you like apples?",
    promptJa: "りんごは すき？",
    choices: ["Do", "Does", "Are", "Is"],
    answer: "Do",
    explanation: "you の しつもんは Do で はじめるよ。",
  },
  {
    promptEn: "This is ___ orange.",
    promptJa: "これは オレンジです。",
    choices: ["an", "a", "some", "two"],
    answer: "an",
    explanation: "a・i・u・e・o の おとは an を つかうよ。orange は o から はじまるね。",
  },
  {
    promptEn: "There ___ two cats.",
    promptJa: "ねこが 2ひき いるよ。",
    choices: ["are", "is", "am", "be"],
    answer: "are",
    explanation: "two cats は ふくすう。だから are だよ。",
  },
  {
    promptEn: "I can ___ fast.",
    promptJa: "わたしは はやく はしれるよ。",
    choices: ["run", "runs", "running", "ran"],
    answer: "run",
    explanation: "can の あとは どうしの もとの かたち（run）だよ。",
  },
  {
    promptEn: "He ___ to school every day.",
    promptJa: "かれは まいにち がっこうへ いくよ。",
    choices: ["goes", "go", "going", "went"],
    answer: "goes",
    explanation: "he の ときは どうしに s（es）が つくよ。go → goes。",
  },
  {
    promptEn: "___ is your name?",
    promptJa: "おなまえは なんですか？",
    choices: ["What", "Who", "Where", "How"],
    answer: "What",
    explanation: "「なに」を きくときは What だよ。",
  },
  {
    promptEn: "I have two ___.",
    promptJa: "はこを 2つ もっているよ。",
    choices: ["boxes", "boxs", "boxies", "box"],
    answer: "boxes",
    explanation: "box は x で おわるから、es を つけて boxes になるよ。",
  },
  {
    promptEn: "Look! It ___ raining.",
    promptJa: "みて！あめが ふっているよ。",
    choices: ["is", "are", "am", "be"],
    answer: "is",
    explanation: "it は ひとつ。だから is だよ。",
  },
  {
    promptEn: "I like cats, ___ I don't like dogs.",
    promptJa: "ねこは すきだけど、いぬは すきじゃないよ。",
    choices: ["but", "and", "so", "because"],
    answer: "but",
    explanation: "「〜だけど」と つなぐときは but だよ。",
  },
  {
    promptEn: "How many ___ do you have?",
    promptJa: "ペンを なんぼん もっている？",
    choices: ["pens", "pen", "penses", "penes"],
    answer: "pens",
    explanation: "How many の あとは ふくすうの かたち。pen → pens。",
  },
];

/* ------------------------------------------------------------------ *
 * 上級 — 文法・文の選択
 * ------------------------------------------------------------------ */

const advancedPool: QuizPoolEntry[] = [
  {
    promptJa: "ただしい ぶんは どれ？",
    choices: [
      "She doesn't like carrots.",
      "She don't like carrots.",
      "She not likes carrots.",
      "She doesn't likes carrots.",
    ],
    answer: "She doesn't like carrots.",
    explanation:
      "she の 否定は doesn't。うしろの どうしは もとの かたち（like）だよ。",
  },
  {
    promptEn: "I have lived here ___ 2019.",
    promptJa: "2019年から ずっと ここに すんでいるよ。",
    choices: ["since", "for", "from", "at"],
    answer: "since",
    explanation: "since は「〜から（時点）」、for は「〜のあいだ（期間）」だよ。",
  },
  {
    promptEn: "If it ___ tomorrow, we'll stay home.",
    promptJa: "あした あめが ふったら、いえに いるよ。",
    choices: ["rains", "rain", "rained", "raining"],
    answer: "rains",
    explanation:
      "If の ぶん（じょうけん）では、みらいの ことでも げんざいけいを つかうよ。",
  },
  {
    promptEn: "This book is ___ than that one.",
    promptJa: "この ほんは あの ほんより おもしろいよ。",
    choices: [
      "more interesting",
      "interesting",
      "most interesting",
      "interestinger",
    ],
    answer: "more interesting",
    explanation:
      "ながい ことばは -er を つけず、more を つけて くらべるよ。",
  },
  {
    promptEn: "He asked me ___ I was hungry.",
    promptJa: "かれは わたしに「おなか すいてる？」と きいたよ。",
    choices: ["if", "that", "what", "because"],
    answer: "if",
    explanation: "「〜かどうか」は if（または whether）で つなぐよ。",
  },
  {
    promptEn: "There are ___ apples than bananas.",
    promptJa: "バナナより りんごの ほうが すくないよ。",
    choices: ["fewer", "less", "few", "little"],
    answer: "fewer",
    explanation:
      "りんごの ように かぞえられる ものは fewer、かぞえられない ものは less だよ。",
  },
  {
    promptEn: "I'm looking forward to ___ you.",
    promptJa: "あなたに あえるのを たのしみに しているよ。",
    choices: ["seeing", "see", "saw", "seen"],
    answer: "seeing",
    explanation:
      "look forward to の to は ぜんちし。うしろは 〜ing の かたちになるよ。",
  },
  {
    promptEn: "The cake ___ by my mother yesterday.",
    promptJa: "その ケーキは きのう おかあさんに つくられたよ。",
    choices: ["was made", "made", "is made", "makes"],
    answer: "was made",
    explanation:
      "「〜された」は うけみ。yesterday があるので かこけい was made だよ。",
  },
  {
    promptEn: "She is the ___ girl in our class.",
    promptJa: "かのじょは クラスで いちばん せが たかいよ。",
    choices: ["tallest", "tall", "taller", "most tall"],
    answer: "tallest",
    explanation:
      "「いちばん〜」は さいじょうきゅう。tall は -est を つけて tallest。",
  },
  {
    promptEn: "___ hard, and you will succeed.",
    promptJa: "がんばれば、きっと うまくいくよ。",
    choices: ["Work", "Working", "To work", "Worked"],
    answer: "Work",
    explanation:
      "「〜しなさい、そうすれば…」は めいれいぶん + and で つなぐよ。",
  },
  {
    promptEn: "This is the restaurant ___ we ate last night.",
    promptJa: "ここが ゆうべ たべた レストランだよ。",
    choices: ["where", "which", "when", "who"],
    answer: "where",
    explanation:
      "ばしょを せつめいする ときは where。うしろは かんせいした ぶんになるよ。",
  },
  {
    promptEn: "Neither Tom ___ his friends were there.",
    promptJa: "トムも かれの ともだちも そこには いなかったよ。",
    choices: ["nor", "or", "and", "but"],
    answer: "nor",
    explanation: "neither A nor B で「AもBも 〜ない」という かたちだよ。",
  },
];

/* ------------------------------------------------------------------ *
 * ラウンド生成
 * ------------------------------------------------------------------ */

function fromPool(
  pool: QuizPoolEntry[],
  idPrefix: string,
  count: number,
): QuizQuestion[] {
  return shuffle(pool)
    .slice(0, count)
    .map((q, i) => {
      // 正解の位置がいつも同じにならないよう、選択肢も並べ替える (#82)
      const choices = shuffle(q.choices);
      const answer = choices.indexOf(q.answer);
      if (answer < 0) {
        // プールの正解文字列が選択肢に無い＝データの書き間違い。放置すると
        // indexOf の -1 がそのまま採点に流れるので、ここで落とす。
        throw new Error(
          `quiz pool: 正解 "${q.answer}" が choices にありません (${idPrefix}-${i})`,
        );
      }
      return {
        ...q,
        id: `${idPrefix}-${i}`,
        choices,
        // QuizQuestion.answer は従来どおり index（採点側の契約は変えない）
        answer,
      };
    });
}

/**
 * レベルに応じた1ラウンド（QUIZ_LENGTH 問）を作る。
 * クライアントのクリックハンドラから呼ぶこと（SSR では呼ばない）。
 */
export function buildRound(
  level: QuizLevelId,
  count: number = QUIZ_LENGTH,
): QuizQuestion[] {
  switch (level) {
    case "listening":
      return buildListeningQuestions(count);
    case "beginner":
      return buildBeginnerQuestions(count);
    case "intermediate":
      return fromPool(intermediatePool, "intermediate", count);
    case "advanced":
      return fromPool(advancedPool, "advanced", count);
  }
}

/** 正答数から星の数（0〜3）を決める */
export function starsFor(correct: number, total: number): number {
  if (total === 0) return 0;
  const ratio = correct / total;
  if (ratio >= 0.9) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.5) return 1;
  return 0;
}
