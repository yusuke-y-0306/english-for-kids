import { notFound } from "next/navigation";
import ModelCheckPanel from "./ModelCheckPanel";

/**
 * 開発専用のモデルキャッシュ確認ページ (issue #29)。
 *
 * 本番ビルドでは 404 にする (fail closed)。実機での切り分けと、
 * staging / 昇格 / 改ざん検出の手動確認に使う。
 * 使い方: `node scripts/models.mjs serve` を別ターミナルで起動 → `npm run dev` →
 *        http://localhost:3000/dev/model-check
 */
export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ModelCheckPanel />;
}
