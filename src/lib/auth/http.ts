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

/** レート制限用のクライアント識別子 */
export async function clientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "local";
}
