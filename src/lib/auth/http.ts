import { headers } from "next/headers";
import { NextResponse } from "next/server";

/** API 共通のヘルパー */

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function jsonOk<T extends Record<string, unknown>>(data: T = {} as T): NextResponse {
  return NextResponse.json({ ok: true, ...data });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const body = (await request.json()) as T;
    if (!body || typeof body !== "object") return null;
    return body;
  } catch {
    return null;
  }
}

export type LimitedJsonResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: "too-large" | "invalid" };

/**
 * サイズ上限つきで JSON を読む (issue #32)。
 *
 * `content-length` は自己申告なので**信用せず**、ストリームを数えながら読む
 * (chunked で送られた場合もそこで打ち切る)。上限を超えたら読み込みを中止して 413 にする。
 */
export async function readJsonLimited<T>(request: Request, limitBytes: number): Promise<LimitedJsonResult<T>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limitBytes) {
    return { ok: false, reason: "too-large" };
  }
  if (!request.body) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, body: parsed as T };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** レート制限用のクライアント識別子 */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "local";
}
