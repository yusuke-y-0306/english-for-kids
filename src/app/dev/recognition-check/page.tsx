import { notFound } from "next/navigation";
import RecognitionCheckPanel from "./RecognitionCheckPanel";

/**
 * 開発専用の認識経路チェック (issue #31)。本番ビルドでは 404。
 * `SpeechRecognition` をスタブして「クラウド経路に入らないこと」を確認するために使う。
 */
export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <RecognitionCheckPanel />;
}
