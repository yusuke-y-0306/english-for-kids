"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MuteToggle } from "@/components/audio/MuteToggle";
import { SpeakButton } from "@/components/audio/SpeakButton";
import PrivacyNotice from "@/components/speech/PrivacyNotice";
import RecognitionPathBadge from "@/components/speech/RecognitionPathBadge";
import SelfReportPrompt from "@/components/speech/SelfReportPrompt";
import {
  DeviceRecognitionError,
  createDeviceRecognizer,
  listenOnce,
  resolveRecognitionSetup,
} from "@/lib/speech/device-recognition";
import type { RecognitionPath } from "@/lib/speech/recognition-policy";
import type { PronunciationScore } from "@/lib/speech/scores";
import { scorePronunciation } from "@/lib/speech/scoring";
import {
  LISTEN_TIMEOUT_MS,
  LISTEN_WATCHDOG_MS,
  isListenStuck,
  listenRemainingMs,
} from "@/lib/speech/listen-watchdog";
import {
  collectSpeechDiagnostics,
  describeSpeechDiagnostics,
  type SpeechDiagnostics,
} from "@/lib/speech/diagnostics";
import {
  WasmRecognitionError,
  detectWasmReadiness,
  isTranscriberLoaded,
  listenOnceWithWasm,
  prepareWasm,
  type PrepareStage,
  type WasmReadiness,
} from "@/lib/speech/wasm-recognition";
import { categories, wordId } from "@/lib/words";

/**
 * 発音練習の画面 — issue #2
 *
 * 設計の要点:
 *  - 認識の経路は `resolveRecognitionSetup()` に**決めさせる**。画面が独断で
 *    `SpeechRecognition` を触らない (クラウド経路に落ちる事故を防ぐ / issue #31)。
 *  - Safari は device が使えないため、アプリ内モデル (wasm) とその「じゅんび」を
 *    同じ判定に含める (issue #79)。
 *  - 判定は端末内で完結する純粋関数 (`scorePronunciation`)。
 *  - 保存するのは**単語 ID と 3 段階スコアだけ**。音声も認識テキストも送らない (issue #32)。
 *  - 記録に失敗しても練習は止めない (子どもの学習を通信の都合で妨げない)。
 *  - 「きいてるよ…」のまま固まらせない (issue #2)。準備が要るなら先に準備を見せ、
 *    それでも返ってこなければ番人が聞き直しへ戻す。
 */

type PracticeWord = {
  id: string;
  en: string;
  ja: string;
  emoji: string;
  /** 事前生成した音声 (#84)。無ければ端末 TTS にフォールバックする */
  audio: string | null;
  /** 同音語 (two → "too")。採点で ok として吸収する */
  homophones?: string[];
  /** 言い換え (mother → "mom")。採点では close 止まり */
  variants?: string[];
};

const PRACTICE_WORDS: PracticeWord[] = categories.flatMap((category) =>
  category.words.map((word) => ({
    id: wordId(word),
    en: word.en,
    ja: word.ja,
    emoji: word.emoji,
    audio: word.audio,
  })),
);

type Phase = "ready" | "listening" | "scored";

type Decision = { path: RecognitionPath; reason: string; canPrepareWasm: boolean };

type Result = {
  score: PronunciationScore;
  hint: string;
  transcript?: string;
};

const SCORE_STYLE: Record<PronunciationScore, { emoji: string; ring: string; text: string }> = {
  ok: { emoji: "🎉", ring: "border-emerald-300 bg-emerald-50", text: "text-emerald-800" },
  close: { emoji: "😊", ring: "border-amber-300 bg-amber-50", text: "text-amber-800" },
  retry: { emoji: "🔁", ring: "border-sky-300 bg-sky-50", text: "text-sky-800" },
};

/** じゅんび中のボタン文言。段階と経過秒を出して「止まっていない」ことを伝える */
function prepareLabel(
  preparing: { fraction: number | null; stage: PrepareStage },
  elapsedSec: number,
): string {
  switch (preparing.stage) {
    case "download":
      return preparing.fraction === null
        ? `じゅんび中… ${elapsedSec}びょう`
        : `じゅんび中… ${Math.round(preparing.fraction * 100)}%`;
    case "verify":
      return `モデルを かくにん中… ${elapsedSec}びょう`;
    case "engine":
      return `エンジンを よみこみ中… ${elapsedSec}びょう`;
    case "engine-init":
      return `エンジンを かくにん中… ${elapsedSec}びょう`;
    case "model":
      return `モデルを よみこみ中… ${elapsedSec}びょう`;
  }
}

export default function PronunciationPanel() {
  const [wordIndex, setWordIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<Result | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [readiness, setReadiness] = useState<WasmReadiness | null>(null);
  const [preparing, setPreparing] = useState<{
    fraction: number | null;
    stage: PrepareStage;
    since: number;
  } | null>(null);
  /** 経過秒の再計算用 (タイマーで進めるだけ) */
  const [now, setNow] = useState(0);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  /**
   * 「いつでも はなせる」状態か (wasm のエンジン読み込み完了)。
   * ホームで先に読み込んであれば (`WasmWarmup`)、開いた時点で true。
   */
  const [engineReady, setEngineReady] = useState(() => isTranscriberLoaded());
  /** 自動のじゅんびに失敗した。押してもらって作り直す */
  const [prepareFailed, setPrepareFailed] = useState(false);
  /** じゅんびに続けて失敗した回数 (2 回で自己申告に切り替える) */
  const prepareFailuresRef = useRef(0);
  /** 認識できなかった等の短い案内 (採点結果とは別に出す) */
  const [notice, setNotice] = useState<string | null>(null);
  /** 聞き取りの世代番号。番人が切り上げたら古い結果を捨てる */
  const listenRunRef = useRef(0);
  /** 聞き取りを始めた時刻。残り秒の表示に使う */
  const [listenSince, setListenSince] = useState<number | null>(null);
  /** 準備が長引いたときだけ出す端末情報 (issue #2 の切り分け用) */
  const [diagnostics, setDiagnostics] = useState<SpeechDiagnostics | null>(null);
  /**
   * 端末内推論の途中で起きたエラー (issue #2)。
   * Emscripten は Worker の失敗を `throw` するだけで Promise を解決しないため、
   * 画面には何も出ずに「終わらない」状態になる。ここで拾って見せる。
   */
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const word = PRACTICE_WORDS[wordIndex];

  /* じゅんび中は経過秒を出す。「止まっている」のか「時間がかかっている」のか
     見分けられるようにする (Safari はモデルの読み込みに数十秒かかる) */
  const prepareSince = preparing?.since ?? null;
  useEffect(() => {
    if (prepareSince === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [prepareSince]);
  const prepareElapsed = prepareSince === null ? 0 : Math.max(0, Math.round((now - prepareSince) / 1000));

  /* 聞き取り中は残り秒を進める。「あと何秒で終わるか」が見えるだけで
     体感の待ち時間は大きく変わる (issue #107) */
  useEffect(() => {
    if (phase !== "listening" || listenSince === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [phase, listenSince]);
  const listenRemaining = listenSince === null ? LISTEN_TIMEOUT_MS : listenRemainingMs(listenSince, now);
  const listenRemainingSec = Math.ceil(listenRemaining / 1000);
  const listenProgress =
    listenSince === null
      ? 0
      : Math.min(1, Math.max(0, (LISTEN_TIMEOUT_MS - listenRemaining) / LISTEN_TIMEOUT_MS));

  // 経路の判定はブラウザ API を触るので、描画中ではなくマウント後に 1 回だけ行う。
  // Safari は device が必ず使えないので、wasm の準備状態 (#79) が体験を決める。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const wasmReadiness = await detectWasmReadiness();
      if (!alive) return;
      setReadiness(wasmReadiness);
      const resolved = await resolveRecognitionSetup(wasmReadiness);
      if (!alive) return;
      setDecision({
        path: resolved.path,
        reason: resolved.reason,
        canPrepareWasm: resolved.canPrepareWasm,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * じゅんび (初回は 51MB の取得)。
   *
   * 「はなす」を押したときにも呼ぶ。モデルは準備済みでも、**ページを開き直すと
   * エンジンの読み直しが要る**ため、そこで無言で待たせない (issue #2)。
   */
  const prepare = useCallback(async (): Promise<boolean> => {
    if (preparing) return false;
    setPrepareError(null);
    setNotice(null);
    setPreparing({ fraction: null, stage: "download", since: Date.now() });
    try {
      await prepareWasm({
        onProgress: (progress) =>
          setPreparing((current) =>
            current === null ? current : { ...current, fraction: progress.fraction },
          ),
        onStage: (stage) =>
          setPreparing((current) => (current === null ? current : { ...current, stage })),
      });
      const resolved = await resolveRecognitionSetup("ready");
      setReadiness("ready");
      setDecision({
        path: resolved.path,
        reason: resolved.reason,
        canPrepareWasm: resolved.canPrepareWasm,
      });
      setPreparing(null);
      setEngineReady(true);
      setPrepareFailed(false);
      prepareFailuresRef.current = 0;
      return true;
    } catch (error) {
      setPreparing(null);
      setEngineReady(false);
      setPrepareFailed(true);
      console.error("[asr] prepare failed", error);
      const detail = error instanceof Error && error.message ? `（${error.message}）` : "";
      setPrepareError(
        `じゅんびが できませんでした${detail}。でんぱの いい ところで もういちど ためしてね`,
      );
      /* 2 回続けてだめなら、その端末では読み込めないと判断して自己申告に切り替える
         (子どもの練習を、終わらない準備で止めない)。 */
      prepareFailuresRef.current += 1;
      if (prepareFailuresRef.current >= 2) {
        setDecision({
          path: "self-report",
          reason: "この端末では アプリ内の よみとりが おもすぎる ようです",
          canPrepareWasm: false,
        });
        setNotice("きょうは じぶんで「いえた」を えらぼう");
      }
      return false;
    }
  }, [preparing]);

  /**
   * モデルが準備済みなら、開いた時点でエンジンを読み込んでおく (issue #2)。
   *
   * 「はなす」を押してから重い準備を始めると、子どもには**押しても何も起きない
   * ボタン**に見える。押される前に準備を終わらせ、押せない理由があるときは
   * 押せないようにする (51MB の取得だけは今までどおり押されてから)。
   */
  useEffect(() => {
    if (decision?.path !== "wasm") return;
    /* 失敗したら自動では再試行しない (電池と通信を無駄にしない)。押されたときにやり直す */
    if (readiness !== "ready" || engineReady || prepareFailed || preparing) return;
    /* 効果の中で同期に状態を動かさない (描画をブロックしない)。次の tick に任せる */
    const timer = setTimeout(() => {
      void prepare();
    }, 0);
    return () => clearTimeout(timer);
  }, [decision, engineReady, prepare, prepareFailed, preparing, readiness]);

  /** 記録は投げっぱなし。失敗しても練習は止めない。 */
  const save = useCallback(async (id: string, score: PronunciationScore) => {
    try {
      await fetch("/api/pronunciation/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // userId は送らない (サーバがセッションから決める)
        body: JSON.stringify({ wordId: id, score }),
      });
    } catch {
      // 学習の妨げにしない
    }
  }, []);

  const finish = useCallback(
    (score: PronunciationScore, hint: string, transcript?: string) => {
      setResult({ score, hint, transcript });
      setPhase("scored");
      void save(word.id, score);
    },
    [save, word.id],
  );

  /** 端末内で 1 回だけ聞き取る (device / wasm のどちらでも) */
  const listen = useCallback(async () => {
    if (!decision || phase === "listening" || preparing) return;

    /* wasm 経路は、このページでまだエンジンを読んでいないことがある。
       そのまま聞き取りに入ると「きいてるよ…」のまま何十秒も止まって見えるので、
       先に「じゅんび」を見せる (進捗と経過秒が出る)。 */
    if (decision.path === "wasm" && !isTranscriberLoaded()) {
      const ready = await prepare();
      if (!ready) return;
    }

    const runId = listenRunRef.current + 1;
    listenRunRef.current = runId;
    const startedAt = Date.now();
    setListenSince(startedAt);
    setNow(startedAt);
    setPhase("listening");
    setResult(null);
    setNotice(null);
    try {
      const transcript =
        decision.path === "wasm"
          ? await listenOnceWithWasm()
          : (await listenOnce(createDeviceRecognizer(decision))).transcript;
      if (runId !== listenRunRef.current) return;
      // 同音語・言い換えは単語データ側の許容を渡して吸収する (issue #40)
      const scored = scorePronunciation(transcript, word.en, {
        homophones: word.homophones,
        variants: word.variants,
      });
      finish(scored.score, scored.hint, transcript);
    } catch (error) {
      if (runId !== listenRunRef.current) return;
      if (error instanceof WasmRecognitionError) {
        setPhase("ready");
        if (error.kind === "empty" || error.kind === "timeout") {
          /* 聞こえなかっただけ。経路は変えず、もう一度いってもらう */
          setNotice("きこえなかったよ。ゆっくり いってみよう");
          return;
        }
        if (error.kind === "mic") {
          setNotice("マイクが つかえませんでした。マイクの きょかを かくにん してね");
          return;
        }
        /* エンジン/モデルの失敗は、その場で自己申告に切り替える (練習を止めない)。
           キャッシュが消えていた場合に備えて、準備状態を読み直してから案内する */
        const wasmReadiness = await detectWasmReadiness().catch((): WasmReadiness => "unsupported");
        setReadiness(wasmReadiness);
        setDecision({
          path: "self-report",
          reason: "アプリ内の よみとりが できませんでした",
          canPrepareWasm: wasmReadiness === "needs-download",
        });
        return;
      }
      // 端末内と証明できない/エラーが出た経路は**リトライしない**。
      // そのまま自己申告に切り替える (issue #31 の方針)。
      if (error instanceof DeviceRecognitionError) {
        setDecision({
          path: "self-report",
          reason:
            error.failure.kind === "not-local"
              ? error.failure.reason
              : "端末内の よみとりが できませんでした",
          canPrepareWasm: readiness === "needs-download",
        });
      }
      setPhase("ready");
    }
  }, [decision, finish, phase, prepare, preparing, readiness, word.en, word.homophones, word.variants]);

  /* 番人: 「きいてるよ…」が長すぎるときは、必ず聞き直しに戻す (issue #2)。
     端末側の各段階にもタイムアウトはあるが、想定外の止まり方をする端末がある。 */
  useEffect(() => {
    if (phase !== "listening") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!isListenStuck(startedAt, Date.now(), LISTEN_WATCHDOG_MS)) return;
      listenRunRef.current += 1; // 遅れて届く結果は捨てる
      setPhase("ready");
      setNotice("きこえなかったよ。もういちど ためしてね");
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  /* 準備が長引いた / 失敗したときだけ、切り分け用の端末情報を集める。
     ふだんの画面には出さない (子どもには意味がない)。 */
  useEffect(() => {
    if (diagnostics) return;
    if (prepareElapsed < 20 && !prepareFailed) return;
    let alive = true;
    void collectSpeechDiagnostics().then((collected) => {
      if (alive) setDiagnostics(collected);
    });
    return () => {
      alive = false;
    };
  }, [diagnostics, prepareElapsed, prepareFailed]);

  /* 画面の外で起きたエラーを拾う。Emscripten の Worker 失敗はここに落ちてくる
     (拾わないと「終わらない」だけが見えて原因が分からない)。 */
  useEffect(() => {
    const describe = (value: unknown): string => {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    };
    const onError = (event: ErrorEvent) => {
      const where = event.filename ? ` (${event.filename}:${event.lineno})` : "";
      setRuntimeError(`${event.message || "エラー"}${where}`);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setRuntimeError(describe(event.reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  /** 自己申告 (最後の砦) */
  const selfReport = useCallback(
    (said: boolean) => {
      if (said) finish("ok", "いえたね！");
      else finish("retry", "もういちど いってみよう");
    },
    [finish],
  );

  const retry = useCallback(() => {
    listenRunRef.current += 1;
    setResult(null);
    setNotice(null);
    setPhase("ready");
  }, []);

  const nextWord = useCallback(() => {
    listenRunRef.current += 1;
    setResult(null);
    setNotice(null);
    setPhase("ready");
    setWordIndex((current) => {
      if (PRACTICE_WORDS.length <= 1) return current;
      let next = current;
      while (next === current) next = Math.floor(Math.random() * PRACTICE_WORDS.length);
      return next;
    });
  }, []);

  const path = decision?.path ?? null;
  const style = result ? SCORE_STYLE[result.score] : null;

  /** マイクに向かって話せる経路か (自己申告なら「はなす」は出さない) */
  const listeningPath = decision?.path === "device" || decision?.path === "wasm";
  /**
   * 押してよい状態か。`device` は API がある時点で話せるが、`wasm` は
   * エンジンの読み込みが終わるまで押させない (issue #2)。
   * 準備に失敗したときは押せるようにして、その場でやり直せるようにする。
   */
  const canListen =
    decision?.path === "device" || (decision?.path === "wasm" && (engineReady || prepareFailed));
  /** 51MB の取得がまだで、本人に押してもらう必要がある状態 */
  const needsExplicitPrepare = Boolean(decision?.canPrepareWasm && readiness === "needs-download");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 rounded-full border-2 border-white bg-white/85 px-3 py-2.5 shadow-[0_5px_16px_rgba(122,104,87,0.12)] sm:px-4">
        <Link
          href="/"
          className="rounded-full px-3 py-1.5 text-sm font-extrabold text-[#5b4a3c] transition hover:bg-[#fff6e3] hover:text-ink"
        >
          ← ホーム
        </Link>
        <h1 className="text-base font-extrabold text-ink sm:text-lg">発音練習</h1>
        <div className="flex items-center gap-1.5">
          {path ? <RecognitionPathBadge path={path} /> : null}
          <MuteToggle />
        </div>
      </header>

      <PrivacyNotice />

      <section className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white bg-white/85 p-6 text-center shadow-[0_10px_30px_rgba(122,104,87,0.12)]">
        <p className="text-sm font-bold text-ink-soft">この ことばを いってみよう</p>
        <div className="text-7xl drop-shadow-sm" aria-hidden>
          {word.emoji}
        </div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          {word.en}
        </p>
        <p className="text-lg font-bold text-ink-soft">{word.ja}</p>

        {/* お手本 (#84)。生成済みの音声なので、端末によって声が変わらない */}
        <SpeakButton word={word} label="お手本を きく" tone="primary" />

        {decision === null && <p className="text-sm text-ink-soft">よみこみ中…</p>}

        {listeningPath && (
          <button
            type="button"
            onClick={() => void listen()}
            /* 準備できていないなら押せない (押しても何も起きないボタンにしない) */
            disabled={!canListen || phase === "listening" || preparing !== null}
            aria-disabled={!canListen || phase === "listening" || preparing !== null}
            aria-label={phase === "listening" ? "いま きいています" : undefined}
            className="rounded-full bg-[#ff8fb0] px-8 py-3 text-lg font-extrabold text-white shadow-[0_4px_0_rgba(176,58,99,0.35)] transition active:translate-y-0.5 active:shadow-none disabled:opacity-60"
          >
            {preparing !== null
              ? prepareLabel(preparing, prepareElapsed)
              : phase === "listening"
                ? listenRemainingSec > 0
                  ? `きいてるよ… あと ${listenRemainingSec}びょう`
                  : "もうすぐ おわるよ…"
                : !canListen
                  ? readiness === "needs-download"
                    ? "まず じゅんびを してね"
                    : "こえの じゅんび中…"
                  : "🎤 はなす"}
          </button>
        )}

        {/* 残り時間のバー。数字と一緒に「終わりが見える」ようにする */}
        {phase === "listening" && (
          <div
            className="h-1.5 w-44 overflow-hidden rounded-full bg-[#ffd9e5]"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-[#ff8fb0] transition-[width] duration-200 ease-linear"
              style={{ width: `${(1 - listenProgress) * 100}%` }}
            />
          </div>
        )}

        {/* 2 回目以降の「はなす」でも、ページを開き直した直後はエンジンの
            読み込みが要る。ボタンの中で何が起きているかだけ伝える (issue #2) */}
        {preparing !== null && (
          <p aria-live="polite" className="text-sm font-bold text-ink-soft">
            こえの じゅんびを しています。そのまま まってね
            <br />
            <span className="text-xs">さいしょの 1 回だけ、1 ぷん くらい かかることが あります</span>
            {prepareElapsed >= 20 && (
              <>
                <br />
                <span className="text-xs text-[#b03a63]">
                  この端末では じかんが かかっています。もうすこし まってね
                </span>
              </>
            )}
            {diagnostics && (
              <>
                <br />
                <span className="text-[10px] text-[#6b5847]">
                  {describeSpeechDiagnostics(diagnostics)}
                </span>
              </>
            )}
            {runtimeError && (
              <>
                <br />
                <span className="text-[10px] break-all text-[#b03a63]">
                  エラー: {runtimeError.slice(0, 200)}
                </span>
              </>
            )}
          </p>
        )}

        {/* Safari など device が使えない端末: モデル未取得なら「じゅんび」を出す。
            勝手に 51MB を落とさない (押されたときだけ)。 */}
        {needsExplicitPrepare && (
          <div className="w-full max-w-sm rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-left">
            <p className="text-xs leading-relaxed font-bold text-amber-900">
              この端末では クラウドの よみとりを つかいません。アプリに モデルを ようい すると、
              こえを おくらずに よみとり できます。
            </p>
            <button
              type="button"
              onClick={() => void prepare()}
              disabled={preparing !== null}
              className="mt-2 w-full rounded-full bg-[#f4801f] px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_#c25f0d] transition active:translate-y-0.5 active:shadow-none disabled:opacity-60"
            >
              {preparing === null
                ? "🔊 こえの じゅんび（51MB）"
                : prepareLabel(preparing, prepareElapsed)}
            </button>
            {preparing !== null && (
              <p className="mt-2 text-xs leading-relaxed font-bold text-amber-900">
                さいしょの 1 回だけ、1 ぷん くらい かかることが あります。
              </p>
            )}
            {prepareError && <p className="mt-2 text-xs font-bold text-red-700">{prepareError}</p>}
          </div>
        )}

        {/* 自動のじゅんびに失敗したときの案内 (準備カードが出ていない場合) */}
        {prepareFailed && prepareError && !needsExplicitPrepare && (
          <p className="text-sm font-bold text-red-700">{prepareError}</p>
        )}

        {/* 自己申告は「まだ判定していないとき」だけ出す。結果が出たあとに
            「もういちど」が 2 つ並ぶのを避ける。 */}
        {decision?.path === "self-report" && !result && (
          <div className="w-full max-w-sm">
            <SelfReportPrompt word={word.en} onAnswer={selfReport} />
          </div>
        )}

        {notice && !result && (
          <p aria-live="polite" className="text-sm font-bold text-[#b03a63]">
            {notice}
          </p>
        )}

        {result && style && (
          <div
            aria-live="polite"
            className={`w-full max-w-sm rounded-xl border-2 p-4 ${style.ring} ${style.text}`}
          >
            <p className="text-2xl font-extrabold">
              {style.emoji} {result.hint}
            </p>
            {result.transcript && (
              <p className="mt-1 text-sm opacity-80">きこえた ことば: “{result.transcript}”</p>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-full border-2 border-[#c98b5e] bg-white px-6 py-2.5 text-sm font-extrabold text-[#5b4a3c] shadow transition hover:bg-[#fff6e3] disabled:opacity-50"
          disabled={phase === "listening"}
        >
          もういちど
        </button>
        <button
          type="button"
          onClick={nextWord}
          className="rounded-full bg-[#4dc9f6] px-6 py-2.5 text-sm font-extrabold text-white shadow-[0_3px_0_rgba(26,111,149,0.35)] transition active:translate-y-0.5 active:shadow-none"
        >
          つぎの ことば →
        </button>
      </div>

      {/* 理由は「なぜ自己申告なのか」を説明するときだけ出す (端末内経路はバッジで十分) */}
      {decision?.path === "self-report" && (
        <p className="text-center text-sm text-[#6b5847]">{decision.reason}</p>
      )}
    </main>
  );
}
