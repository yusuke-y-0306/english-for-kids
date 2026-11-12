import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test, { describe } from "node:test";
import {
  PUBLIC_EXACT,
  PUBLIC_PREFIX,
  denialFor,
  evaluateRoute,
  isApiPath,
  isPublicPath,
  publicRouteList,
} from "../../src/lib/auth/gate.ts";

/**
 * 認可の入口 (issue #54) のテスト。
 *
 * ここで固定したい主張は **「default-deny」** ただひとつ:
 * allowlist に無い経路は、たとえ今日存在しないパスでも「セッション必須」と
 * 判定される。新しい API を足したときに何もしなくても守られる、という保証を
 * テストで縛る。
 */

describe("default-deny", () => {
  test("allowlist に無いパスはセッション必須", () => {
    const paths = [
      "/",
      "/quiz",
      "/flashcards",
      "/build",
      "/pronunciation",
      "/api/auth/me",
      "/api/auth/users", // #54 で削除した経路。戻ってきたらここで気づく
      "/api/pronunciation/attempt",
      "/api/does-not-exist-yet",
      "/api/v2/brand-new-endpoint",
      "/settings/new-page",
    ];
    for (const p of paths) {
      assert.equal(evaluateRoute(p), "session", `${p} は非公開のはず`);
    }
  });

  test("未知のパスでも 404 より先に認可の判断がされる", () => {
    // 経路が存在するかどうかと無関係に「非公開」と判定される = 門番が先に立つ
    assert.equal(isPublicPath("/api/not-implemented"), false);
    assert.equal(isPublicPath("/totally/unknown"), false);
  });
});

describe("公開経路は最小限", () => {
  test("ログインに必要なものだけが公開される", () => {
    const publicPaths = [
      "/login",
      "/api/auth/logout",
      "/api/auth/login/options",
      "/api/auth/login/verify",
      "/api/auth/setup/options",
      "/api/auth/setup/verify",
      "/api/auth/setup/children",
      "/api/auth/revoke",
      "/api/auth/devices",
      "/_next/static/chunk/abc.js",
      "/favicon.ico",
      "/asr/moonshine/index.js",
      "/asr/capture-worklet.js",
    ];
    for (const p of publicPaths) {
      assert.equal(evaluateRoute(p), "public", `${p} は公開のはず`);
    }
  });

  test("接頭辞はセグメント境界で切る (/login-extra を通さない)", () => {
    assert.equal(isPublicPath("/login"), true);
    assert.equal(isPublicPath("/login/extra"), false, "/login は完全一致だけ公開");
    assert.equal(isPublicPath("/loginfoo"), false);
    assert.equal(isPublicPath("/login-extra"), false);
    assert.equal(isPublicPath("/api/auth/login-evil"), false);
    assert.equal(isPublicPath("/api/auth/loginXYZ"), false);
  });

  test("公開経路の数が増えていたら気づけるようにしておく", () => {
    // 「増やすときは理由を書いてレビューする」ためのスナップショット。
    // 意図して増やすならこの数字とテストを更新する。
    assert.equal(PUBLIC_EXACT.length, 4);
    assert.equal(PUBLIC_PREFIX.length, 6);
    for (const route of publicRouteList()) {
      assert.ok(route.reason.length > 5, `${route.path} に理由が書かれていない`);
    }
  });
});

describe("拒否時の返し方", () => {
  test("API は 401 JSON、HTML は /login へ", () => {
    assert.deepEqual(denialFor("/api/quiz"), { kind: "json", status: 401 });
    assert.deepEqual(denialFor("/api"), { kind: "json", status: 401 });
    assert.deepEqual(denialFor("/quiz"), { kind: "redirect", to: "/login" });
    assert.deepEqual(denialFor("/"), { kind: "redirect", to: "/login" });
  });

  test("isApiPath", () => {
    assert.equal(isApiPath("/api"), true);
    assert.equal(isApiPath("/api/auth/me"), true);
    assert.equal(isApiPath("/apiary"), false);
    assert.equal(isApiPath("/"), false);
  });
});

/**
 * 構造テスト — `src/app` に置かれたページ / API が gate の判断対象から
 * 漏れていないことを確かめる。proxy の matcher から外れた場所に新しい
 * ルートを作ると、ここが落ちる。
 */
describe("app 配下のルートは全て判断対象", () => {
  async function collectRoutes(dir, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true });
    const routes = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // ルートグループ `(protected)` は URL に出ない
        const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
        routes.push(...(await collectRoutes(full, `${prefix}${segment}`)));
        continue;
      }
      if (entry.name === "page.tsx" || entry.name === "route.ts") {
        routes.push(prefix === "" ? "/" : prefix);
      }
    }
    return routes;
  }

  test("全てのルートが public / session のどちらかに分類される", async () => {
    const appDir = path.join(process.cwd(), "src", "app");
    const routes = await collectRoutes(appDir);
    assert.ok(routes.length > 5, "ルートが取れていない");

    for (const route of routes) {
      const access = evaluateRoute(route);
      assert.ok(access === "public" || access === "session");
    }

    // 公開されているページは /login だけ (それ以外の画面は要ログイン)
    const publicPages = routes.filter(
      (r) => !isApiPath(r) && evaluateRoute(r) === "public",
    );
    assert.deepEqual(publicPages.sort(), ["/login"]);
  });
});
