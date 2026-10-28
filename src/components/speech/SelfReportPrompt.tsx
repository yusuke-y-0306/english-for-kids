"use client";

/**
 * 自己申告モード — issue #31
 * 端末内認識が使えないときの最後の砦。通信ゼロで学習を止めない。
 */
export default function SelfReportPrompt({
  word,
  onAnswer,
}: {
  word: string;
  onAnswer: (said: boolean) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-sky-300 bg-sky-50 p-4 text-center">
      <p className="mb-3 text-sm text-sky-900">
        「<strong>{word}</strong>」を こえに だせたかな？
      </p>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-white"
        >
          いえた！
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="rounded-full bg-gray-200 px-5 py-2 text-sm font-bold text-gray-700"
        >
          もういちど
        </button>
      </div>
    </div>
  );
}
