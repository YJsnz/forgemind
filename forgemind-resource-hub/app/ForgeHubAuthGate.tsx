"use client";

import { useEffect, useState, type ReactNode } from "react";

const TOKEN_KEY = "forgemind.token";
const API_KEY = "forgemind.apiBase";
const DEFAULT_API_BASE = "http://127.0.0.1:8080";
const DEFAULT_PORTAL_URL = "http://127.0.0.1:5173/forgehub";

type AuthState =
  | { phase: "checking" }
  | { phase: "ready"; username: string }
  | { phase: "denied"; message: string };

function consumePortalHandoff() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("token")?.trim();
  const apiBase = fragment.get("api")?.trim().replace(/\/$/, "");

  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  if (apiBase) window.localStorage.setItem(API_KEY, apiBase);
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  return {
    token: token || window.localStorage.getItem(TOKEN_KEY),
    apiBase: apiBase || window.localStorage.getItem(API_KEY) || DEFAULT_API_BASE,
  };
}

export function ForgeHubAuthGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ phase: "checking" });

  useEffect(() => {
    const { token, apiBase } = consumePortalHandoff();
    if (!token) {
      queueMicrotask(() => setAuth({ phase: "denied", message: "请先通过 ForgePass 登录，再进入 ForgeHub。" }));
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    fetch(`${apiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 ? "ForgePass 会话已失效，请重新登录。" : `身份服务返回 ${response.status}`);
        return response.json() as Promise<{ username?: string }>;
      })
      .then((result) => setAuth({ phase: "ready", username: result.username?.trim() || "ForgePass 用户" }))
      .catch((error: unknown) => {
        window.localStorage.removeItem(TOKEN_KEY);
        setAuth({ phase: "denied", message: error instanceof Error && error.name !== "AbortError" ? error.message : "无法连接 ForgePass 身份服务。" });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  if (auth.phase === "ready") return <div data-forgepass-user={auth.username}>{children}</div>;

  return (
    <main className="forgehub-auth-shell">
      <section className="forgehub-auth-card" aria-live="polite">
        <span>FORGEPASS / FORGEHUB</span>
        <h1>{auth.phase === "checking" ? "正在验证统一身份" : "需要 ForgePass 身份"}</h1>
        <p>{auth.phase === "checking" ? "正在确认你的 ForgeMind 会话，请稍候。" : auth.message}</p>
        {auth.phase === "denied" && <a href={DEFAULT_PORTAL_URL}>返回 ForgeMind 登录</a>}
      </section>
    </main>
  );
}
