"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AVATARS } from "@/lib/auth/avatars";
import { normalizePassphrase } from "@/lib/auth/passphrase";
import type { PickerUser } from "@/lib/auth/pool";

type Props = {
  users: PickerUser[];
  needsSetup: boolean;
  /** いま この端末で ログイン中のユーザー (いなければ null) */
  currentUser?: {
    id: string;
    displayName: string;
    avatar: string;
    color: string;
  } | null;
};

type SetupMode = "first" | "new" | "device";

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

/* ブラウザ対応状況は「外部システムの状態」なので useSyncExternalStore で読む
   (SSR 時は対応している前提で描画し、ハイドレート後に実際の値へ追従) */
const noopSubscribe = () => () => {};

/**
 * アプリ内ブラウザ (Telegram / LINE / Instagram など) を検出する。
 * これらは WebView で動くため WebAuthn (指紋・顔) が使えないことが多い。
 * その場合は「Safari で ひらいてね」と案内する。
 */
function detectInAppBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Telegram/i.test(ua)) return "Telegram";
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/MicroMessenger/i.test(ua)) return "WeChat";
  if (/\bTwitter\b|\bX\b.*Twitter/i.test(ua)) return "X";
  return null;
}

function useInAppBrowser(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => detectInAppBrowser(),
    () => null,
  );
}

/**
 * iOS のサードパーティ製ブラウザ (Chrome / Firefox / Edge) を検出する。
 * iOS の Chrome (WKWebView) は isUserVerifyingPlatformAuthenticatorAvailable() が
 * 常に false を返す既知の不具合があり、実際には登録できるのに「非対応」と
 * 誤判定される。そのため判定結果で処理を止めず、案内だけ出す。
 */
function detectIOSThirdPartyBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod/.test(ua)) return null;
  if (/CriOS/i.test(ua)) return "Chrome";
  if (/FxiOS/i.test(ua)) return "Firefox";
  if (/EdgiOS/i.test(ua)) return "Edge";
  return null;
}

function useIOSThirdPartyBrowser(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => detectIOSThirdPartyBrowser(),
    () => null,
  );
}

async function postJson<T>(url: string, body: unknown): Promise<ApiOk<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ApiOk<T> | ApiErr;
  if (!res.ok || !("ok" in data) || !data.ok) {
    const message =
      "error" in data && typeof data.error === "string"
        ? data.error
        : "エラーが おきました。もういちど やってみてね";
    throw new Error(message);
  }
  return data;
}

function friendlyError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") {
    return "キャンセル したね。もういちど おしてね";
  }
  if (name === "InvalidStateError") {
    return "この たんまつは すでに とうろく されています";
  }
  if (name === "NotSupportedError") {
    return "この ブラウザでは ゆび/かお が つかえません。iPhone は Safari で ひらいてね";
  }
  const message = (error as Error)?.message;
  return message && message.length < 120
    ? message
    : "うまく いきませんでした。もういちど おねがいします";
}

export default function LoginPanel({ users, needsSetup, currentUser = null }: Props) {
  const router = useRouter();
  const inAppBrowser = useInAppBrowser();
  const iosThirdParty = useIOSThirdPartyBrowser();
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => browserSupportsWebAuthn(),
    () => true,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [parentOpen, setParentOpen] = useState(needsSetup);
  const [mode, setMode] = useState<SetupMode>(needsSetup ? "first" : "device");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0].emoji);
  const [passphrase, setPassphrase] = useState("");
  const [targetUserId, setTargetUserId] = useState(users[0]?.id ?? "");
  const [logoutBusy, setLogoutBusy] = useState(false);

  const selectedUserId = targetUserId || users[0]?.id || "";
  const passphraseLabel =
    mode === "first"
      ? "おうちの 合言葉を きめる（8もじ いじょう）"
      : "おうちの 合言葉（保護者パスフレーズ）";

  function goHome() {
    router.replace("/");
    router.refresh();
  }

  async function logout() {
    setLogoutBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
    } finally {
      setLogoutBusy(false);
    }
  }

  async function login(userId: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error("この ブラウザでは ゆび/かお ログインが つかえません");
      }
      const { options } = await postJson<{ options: PublicKeyCredentialRequestOptionsJSON }>(
        "/api/auth/login/options",
        { userId },
      );
      const response: AuthenticationResponseJSON = await startAuthentication({
        optionsJSON: options,
      });
      await postJson("/api/auth/login/verify", { userId, response });
      goHome();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error("この ブラウザでは ゆび/かお を とうろく できません");
      }
      /* 生体認証の有無は「ヒント」として扱う。
         iOS の Chrome は isUVPAA() が常に false を返す既知の不具合があるため、
         false でも登録を試みる (実際には成功することがある)。 */
      const platformAvailable = await platformAuthenticatorIsAvailable().catch(() => true);
      if (!platformAvailable && !iosThirdParty) {
        setNotice(
          "この ブラウザは ゆび/かお を うまく つかめない かも。うまく いかない ときは Safari で ひらいてね。",
        );
      }

      const payload: Record<string, unknown> = {
        mode,
        guardianPassphrase: normalizePassphrase(passphrase),
      };
      if (mode === "device") payload.userId = selectedUserId;
      if (mode === "first" || mode === "new") {
        payload.displayName = displayName;
        payload.avatar = avatar;
      }

      const { options } = await postJson<{
        options: PublicKeyCredentialCreationOptionsJSON;
      }>("/api/auth/setup/options", payload);

      const response: RegistrationResponseJSON = await startRegistration({
        optionsJSON: options,
      });

      await postJson("/api/auth/setup/verify", { response });
      goHome();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const busyClass = busy ? "pointer-events-none opacity-60" : "";

  if (!supported) {
    return (
      <div className="mt-10 rounded-[26px] border-4 border-white bg-white/80 p-6 text-center shadow-[0_8px_20px_rgba(122,104,87,0.14)]">
        <p className="text-base font-extrabold text-ink">
          この ブラウザでは ログインできません
        </p>
        <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
          iPad / iPhone の Safari、または Chrome で ひらいてね。
          <br />
          （ゆび か かお の とうろくが ひつようです）
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {currentUser && (
        <div className="mx-auto mb-5 flex max-w-md items-center justify-between gap-3 rounded-2xl border-2 border-white bg-white/85 px-4 py-2.5 shadow-[0_4px_0_rgba(138,90,59,0.12)]">
          <span className="flex items-center gap-2 text-xs font-extrabold text-[#5b4a3c]">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full text-base"
              style={{ backgroundColor: currentUser.color }}
            >
              {currentUser.avatar}
            </span>
            {currentUser.displayName} で ログインちゅう
          </span>
          <button
            type="button"
            onClick={logout}
            disabled={logoutBusy}
            className="rounded-full border-2 border-[#e6d9c8] px-3 py-1.5 text-xs font-extrabold text-[#5b4a3c] transition hover:border-[#f4801f] hover:text-[#c25f0d] disabled:opacity-50"
          >
            {logoutBusy ? "…" : "おわる"}
          </button>
        </div>
      )}
      {inAppBrowser && (
        <div className="mx-auto mb-5 max-w-md rounded-2xl border-2 border-[#e0b21c] bg-[#fff8e1] px-4 py-3 text-center text-xs leading-relaxed font-extrabold text-[#a85f08]">
          いま {inAppBrowser} の なか で ひらいています。
          <br />
          ゆび/かお ログインは つかえないので、
          <br />
          画面の うえ の「…」や 共有ボタン から
          <br />
          <span className="text-[#b03a63]">「Safari で ひらく」</span> を えらんでね。
        </div>
      )}
      {!inAppBrowser && iosThirdParty && (
        <div className="mx-auto mb-5 max-w-md rounded-2xl border-2 border-[#e0b21c] bg-[#fff8e1] px-4 py-3 text-center text-xs leading-relaxed font-extrabold text-[#a85f08]">
          iPhone / iPad の {iosThirdParty} では、
          <br />
          ゆび/かお の とうろくが うまく いかない ことが あります。
          <br />
          うまく いかない ときは
          <br />
          <span className="text-[#b03a63]">Safari で ひらいてね</span>
          （iOS 26.3 で かいぜん されます）。
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mx-auto mb-5 max-w-md rounded-2xl border-2 border-[#ffb3c6] bg-[#fff0f4] px-4 py-3 text-center text-sm font-extrabold text-[#b03a63]"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="mx-auto mb-5 max-w-md rounded-2xl border-2 border-[#e0b21c] bg-[#fff8e1] px-4 py-3 text-center text-xs font-bold text-[#a85f08]">
          {notice}
        </p>
      )}

      {users.length > 0 && !needsSetup && (
        <ul className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${busyClass}`}>
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => login(user.id)}
                disabled={busy || user.credentialCount === 0}
                className="group flex w-full flex-col items-center gap-2 rounded-[26px] border-4 border-white bg-white/85 px-3 py-6 shadow-[0_8px_20px_rgba(122,104,87,0.14)] transition hover:-translate-y-1 hover:shadow-[0_14px_26px_rgba(122,104,87,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className="flex h-16 w-16 items-center justify-center rounded-full text-3xl shadow-[0_4px_0_rgba(61,50,41,0.12)]"
                  style={{ backgroundColor: user.color }}
                >
                  {user.avatar}
                </span>
                <span className="text-base font-extrabold text-ink">{user.displayName}</span>
                <span className="text-[0.7rem] font-bold text-[#8f7a5e]">
                  {user.credentialCount === 0 ? "とうろく まち" : "ゆび か かお で ログイン"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {users.length > 0 && !needsSetup && (
        <p className="mx-auto mt-4 max-w-md text-center text-[0.7rem] leading-relaxed font-bold text-[#8f7a5e]">
          はじめて つかう たんまつ の ときは、
          <br className="sm:hidden" />
          下の「おうちの ひと」から とうろくしてね。
          <br />
          あたらしい こどもを ふやす のも 同じ ばしょ です。
        </p>
      )}

      {needsSetup && (
        <p className="mb-6 rounded-2xl border-2 border-dashed border-[#e0b21c] bg-[#fff8e1] px-4 py-3 text-center text-sm font-extrabold text-[#a85f08]">
          はじめに、おうちの ひとが とうろくしてね
        </p>
      )}

      {!needsSetup && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setParentOpen((open) => !open)}
            aria-expanded={parentOpen}
            className="inline-flex min-h-12 items-center justify-center rounded-full border-2 border-[#d8c7b2] bg-white/80 px-5 py-2.5 text-sm font-extrabold text-[#5b4a3c] shadow-[0_3px_0_rgba(138,90,59,0.14)] transition hover:-translate-y-0.5 hover:border-[#f4801f] hover:text-[#c25f0d] active:translate-y-0.5"
          >
            {parentOpen ? "とじる" : "🔑 おうちの ひと（こども・端末を ふやす）"}
          </button>
        </div>
      )}

      {parentOpen && (
        <section className="mt-5 rounded-[26px] border-4 border-white bg-white/85 p-5 shadow-[0_8px_20px_rgba(122,104,87,0.14)] sm:p-7">
          <h2 className="text-center text-base font-extrabold text-ink">
            おうちの ひと メニュー
          </h2>
          <p className="mt-2 text-center text-xs leading-relaxed font-bold text-[#8f7a5e]">
            子どもは ID・パスワードを うちません。
            <br className="hidden sm:block" />
            おうちの 合言葉（保護者パスフレーズ）は 1 つだけ。
            <br className="hidden sm:block" />
            こどもを ふやす ときも、端末を ふやす ときも 同じ 合言葉です。
          </p>

          {!needsSetup && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <ModeButton
                active={mode === "device"}
                onClick={() => setMode("device")}
                label="この たんまつを とうろく"
              />
              <ModeButton
                active={mode === "new"}
                onClick={() => setMode("new")}
                label="あたらしい こどもを ふやす"
              />
            </div>
          )}

          <div className={`mt-5 grid gap-4 ${busyClass}`}>
            {(mode === "first" || mode === "new") && (
              <>
                <label className="block">
                  <span className="text-xs font-extrabold text-[#5b4a3c]">なまえ</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="はなこ"
                    className="mt-1 w-full rounded-xl border-2 border-[#e6d9c8] bg-white px-3 py-2.5 text-base font-bold text-ink outline-none focus:border-[#f4801f]"
                  />
                </label>

                <div>
                  <span className="text-xs font-extrabold text-[#5b4a3c]">えらぶ どうぶつ</span>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {AVATARS.map((choice) => (
                      <li key={choice.emoji}>
                        <button
                          type="button"
                          onClick={() => setAvatar(choice.emoji)}
                          aria-label={choice.label}
                          aria-pressed={avatar === choice.emoji}
                          className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition ${
                            avatar === choice.emoji
                              ? "ring-4 ring-[#f4801f] ring-offset-1"
                              : "ring-2 ring-white"
                          }`}
                          style={{ backgroundColor: choice.color }}
                        >
                          {choice.emoji}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {mode === "device" && users.length > 0 && (
              <label className="block">
                <span className="text-xs font-extrabold text-[#5b4a3c]">どの こども？</span>
                <select
                  value={selectedUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-[#e6d9c8] bg-white px-3 py-2.5 text-base font-bold text-ink outline-none focus:border-[#f4801f]"
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.avatar} {user.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="text-xs font-extrabold text-[#5b4a3c]">
                {passphraseLabel}
              </span>
              <span className="mt-1 block text-[0.7rem] leading-relaxed font-bold text-[#8f7a5e]">
                {mode === "first"
                  ? "これが おうち 共通の 合言葉に なります。わすれないように メモしてね。"
                  : "おうちの ひとが さいしょに きめた 合言葉です。"}
              </span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1 w-full rounded-xl border-2 border-[#e6d9c8] bg-white px-3 py-2.5 text-base font-bold text-ink outline-none focus:border-[#f4801f]"
              />
            </label>

            <button
              type="button"
              onClick={register}
              disabled={busy}
              className="mt-1 inline-flex min-h-12 items-center justify-center rounded-full bg-[#f4801f] px-6 py-3 text-base font-extrabold text-white shadow-[0_5px_0_#c25f0d] transition hover:-translate-y-0.5 hover:shadow-[0_7px_0_#c25f0d] active:translate-y-1 active:shadow-[0_2px_0_#c25f0d] disabled:opacity-60"
            >
              {busy ? "とうろく ちゅう…" : "ゆび/かお を とうろく する"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-xs font-extrabold transition ${
        active
          ? "bg-badge text-white shadow-[0_3px_0_rgba(61,50,41,0.28)]"
          : "bg-white text-[#5b4a3c] ring-2 ring-[#e6d9c8]"
      }`}
    >
      {label}
    </button>
  );
}
