import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import { LoginPanel } from "./login/LoginPanel";
import { ThemeProvider, useColorTheme } from "./login/theme";
import { BrowserSession, request } from "./browser-session";
import type { RemoteDevice } from "./types";
import {
  LocalCache,
  cachedDirectoryRpc,
  clearLocalCaches,
  getLastHost,
  setLastHost,
  syncNativeCurrentSession,
} from "./local-cache";
import "antd/dist/reset.css";
import "./login/upstream.css";
import "./login/selfhost.css";
import "./style.css";
declare global {
  interface Window {
    dshRemoteTransport?: unknown;
  }
}
function App() {
  const [account, setAccount] = useState<string | null>();
  const [hosts, setHosts] = useState<RemoteDevice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [connected, setConnected] = useState<RemoteDevice>();
  const [pending, setPending] = useState<RemoteDevice>();
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [cacheState, setCacheState] = useState<"cached" | "fresh" | "error">();
  const cacheBridge = React.useRef<ReturnType<typeof cachedDirectoryRpc>>();
  const [session] = useState(
    () =>
      new BrowserSession(() => {
        cacheBridge.current?.close();
        window.dshRemoteTransport = undefined;
        setDirectoryLoading(false);
        setConnected(undefined);
        setError("与电脑的连接已断开。请重新连接；消息不会自动重发。");
      }, setDirectoryLoading),
  );
  const { colorTheme } = useColorTheme();
  async function refresh(currentAccount = account, autoConnect = false) {
    try {
      const d = await request("/account/devices");
      const list = d.items.filter((x: RemoteDevice) => x.role === "host");
      setHosts(list);
      if (autoConnect && currentAccount) {
        const lastId = getLastHost(currentAccount);
        const target = lastId
          ? list.find((x: RemoteDevice) => x.deviceId === lastId && x.online)
          : undefined;
        if (target) void connect(target, currentAccount, true);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const onLogout = (event: StorageEvent) => {
      if (event.key !== "dsh-web-logout") return;
      cacheBridge.current?.close();
      void session.disconnect();
      session.clear();
      window.dshRemoteTransport = undefined;
      setConnected(undefined);
      setAccount(null);
    };
    window.addEventListener("storage", onLogout);
    request("/auth/me")
      .then((a) => {
        setAccount(a.account);
        void refresh(a.account, true);
      })
      .catch(() => setAccount(null));
    return () => {
      window.removeEventListener("storage", onLogout);
      void session.disconnect();
    };
  }, []);
  async function connect(
    host: RemoteDevice,
    currentAccount = account,
    silentUntrusted = false,
  ) {
    setBusy(host.deviceId);
    setError("");
    try {
      const detail = await session.host(host.deviceId);
      if (!session.trusted(detail)) {
        if (!silentUntrusted) setPending(detail);
        return;
      }
      if (currentAccount) setLastHost(currentAccount, detail.deviceId);
      cacheBridge.current?.close();
      const local = new LocalCache(
        currentAccount!,
        detail.deviceId,
        detail.identityKey,
      );
      syncNativeCurrentSession(local.current);
      setCacheState(local.directory ? "cached" : undefined);
      const rpc = await session.connect(detail);
      const cached = cachedDirectoryRpc(rpc, local, setCacheState);
      cacheBridge.current = cached;
      window.dshRemoteTransport = {
        rpc: cached,
        cache: local,
        onUnsupportedUpload: () =>
          setError(
            "当前电脑的 Remote 接口不支持文件上传。请移除文件后继续发送文字。",
          ),
      };
      setConnected(detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function logout() {
    cacheBridge.current?.close();
    localStorage.setItem("dsh-web-logout", crypto.randomUUID());
    setConnected(undefined);
    await session.disconnect();
    session.clear();
    window.dshRemoteTransport = undefined;
    await clearLocalCaches();
    try {
      await request("/auth/logout", {});
    } finally {
      setAccount(null);
    }
  }
  return (
    <ConfigProvider
      theme={{
        algorithm:
          colorTheme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: { colorPrimary: "#1677ff" },
      }}
    >
      {account === undefined ? (
        <main className="loading" role="status">
          正在检查登录状态…
        </main>
      ) : account === null ? (
        <LoginPanel
          onAuthSuccess={(a) => {
            setAccount(a.account);
            void refresh(a.account, true);
          }}
          initialError={error}
        />
      ) : (
        <div className="remote-app">
          <header className="remote-header">
            <strong>DSH Remote</strong>
            <span>{connected?.name ?? "选择电脑"}</span>
            <div className="header-actions">
              {connected && (
                <button
                  onClick={async () => {
                    if (account) setLastHost(account, undefined);
                    cacheBridge.current?.close();
                    await session.disconnect();
                    setConnected(undefined);
                    window.dshRemoteTransport = undefined;
                    void refresh(account, false);
                  }}
                >
                  切换电脑
                </button>
              )}
              <span>{account}</span>
              <button onClick={() => void logout()}>退出登录</button>
            </div>
          </header>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {connected &&
            (directoryLoading ||
              cacheState === "cached" ||
              cacheState === "error") && (
              <div className="directory-loading" role="status">
                {cacheState === "error"
                  ? "目录更新失败，当前显示上次缓存。请重新连接重试。"
                  : cacheState === "cached"
                    ? "已显示本地目录，后台正在更新。运行状态和审批以电脑实时确认为准。"
                    : "正在读取会话目录，历史较多时可能需要一些时间…"}
              </div>
            )}
          {connected ? (
            <iframe
              title="DSH 工作区"
              className="native-frame"
              src="/native/index.html"
            />
          ) : (
            <main className="device-main">
              <h1>连接你的电脑</h1>
              <p>选择在线设备，继续使用电脑上的工作区和对话。</p>
              <button className="refresh" onClick={() => void refresh()}>
                刷新设备
              </button>
              <div className="device-list">
                {hosts.map((host) => (
                  <button
                    className="device"
                    key={host.deviceId}
                    disabled={!host.online || !!busy}
                    onClick={() => void connect(host)}
                  >
                    <div>
                      <strong>{host.name}</strong>
                      <small>DSH {host.harnessVersion ?? "未知版本"}</small>
                    </div>
                    <span>
                      {busy === host.deviceId
                        ? "正在建立加密连接…"
                        : host.online
                          ? "连接"
                          : "离线"}
                    </span>
                  </button>
                ))}
                {hosts.length === 0 && (
                  <p>还没有电脑。请先在电脑的 Remote 插件中登录同一账号。</p>
                )}
              </div>
            </main>
          )}
          {pending && (
            <div className="modal-backdrop">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="trust-title"
                className="trust"
              >
                <h2 id="trust-title">确认电脑的安全身份</h2>
                <p>{pending.name}</p>
                <p>
                  请核对电脑 Remote
                  显示的身份指纹。身份发生变化时，需要重新确认。
                </p>
                <code>{session.fingerprint(pending)}</code>
                <footer>
                  <button onClick={() => setPending(undefined)}>取消</button>
                  <button
                    className="primary"
                    onClick={() => {
                      session.trust(pending);
                      const host = pending;
                      setPending(undefined);
                      void connect(host);
                    }}
                  >
                    信任并连接
                  </button>
                </footer>
              </section>
            </div>
          )}
        </div>
      )}
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  void navigator.serviceWorker
    .register("/resource-sw.js", { updateViaCache: "none" })
    .catch(() => {});
}
