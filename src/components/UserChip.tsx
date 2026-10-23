"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Me = {
  id: string;
  displayName: string;
  avatar: string;
  color: string;
};

/**
 * ヘッダーに出す「いま だれが つかっているか」表示 + ログアウト。
 * クライアント側で /api/auth/me を叩くので、どのページからでも使える。
 */
export default function UserChip() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { user: Me | null }) => {
        if (alive) setMe(data.user ?? null);
      })
      .catch(() => {
        /* 表示できなくても致命的ではない */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return null;

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-2 flex items-center gap-1.5">
      <span
        className="flex items-center gap-1.5 rounded-full border-2 border-white bg-white/80 py-1 pr-3 pl-1 shadow-[0_2px_0_rgba(138,90,59,0.18)]"
        title={`${me.displayName} で ログインちゅう`}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full text-base"
          style={{ backgroundColor: me.color }}
        >
          {me.avatar}
        </span>
        <span className="hidden text-xs font-extrabold text-[#5b4a3c] sm:inline">
          {me.displayName}
        </span>
      </span>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="rounded-full px-2.5 py-1.5 text-xs font-extrabold text-[#8f7a5e] transition hover:bg-white hover:text-ink disabled:opacity-50"
      >
        おわる
      </button>
    </span>
  );
}
