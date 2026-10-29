import { generateKeyPair, identityFingerprint } from "@dsh-remote/crypto";
import { AdaptiveTransport } from "@dsh-remote/webrtc";
import {
  RemoteClientCore,
  RemoteTypertGateway,
  probeRemoteHostFeatures,
} from "@dsh-remote/client-core";
import { SecureTransport } from "./secure-transport";
import type { DeviceIdentity, RemoteDevice } from "./types";

export async function request(path: string, body?: unknown, token?: string) {
  const r = await fetch("/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok)
    throw Object.assign(
      Error(
        r.status === 401
          ? "登录已失效，请重新登录。"
          : `请求失败（${r.status}）`,
      ),
      { status: r.status },
    );
  return r.json();
}
export class BrowserSession {
  private core?: RemoteClientCore;
  private generation = 0;
  private identity: DeviceIdentity;
  private credentials?: { accessToken: string; accessTokenExpiresAt: number };
  private directoryReads = 0;
  constructor(
    private readonly onClosed: () => void,
    private readonly onDirectoryLoading: (loading: boolean) => void = () => {},
  ) {
    const saved = sessionStorage.getItem("dsh-web-identity");
    this.identity = saved
      ? JSON.parse(saved)
      : { deviceId: crypto.randomUUID(), ...generateKeyPair() };
    sessionStorage.setItem("dsh-web-identity", JSON.stringify(this.identity));
  }
  async authorize() {
    sessionStorage.setItem("dsh-web-identity", JSON.stringify(this.identity));
    if (
      this.credentials &&
      this.credentials.accessTokenExpiresAt > Date.now() + 30_000
    )
      return;
    this.credentials = await request("/devices/register", {
      v: 1,
      device: {
        deviceId: this.identity.deviceId,
        name: "Web · " + navigator.platform,
        role: "client",
        platform: "browser",
        identityKey: this.identity.publicKey,
        clientVersion: "0.5.19",
      },
    });
  }
  async host(id: string): Promise<RemoteDevice> {
    await this.authorize();
    return request(
      "/devices/" + encodeURIComponent(id),
      undefined,
      this.credentials!.accessToken,
    );
  }
  fingerprint(host: RemoteDevice) {
    return identityFingerprint(host.identityKey);
  }
  trusted(host: RemoteDevice) {
    return (
      localStorage.getItem("dsh-web-trust:" + host.deviceId) ===
      host.identityKey
    );
  }
  trust(host: RemoteDevice) {
    localStorage.setItem("dsh-web-trust:" + host.deviceId, host.identityKey);
  }
  async connect(host: RemoteDevice) {
    const generation = ++this.generation;
    const previous = this.core;
    this.core = undefined;
    this.directoryReads = 0;
    this.onDirectoryLoading(false);
    await previous?.close();
    await this.authorize();
    if (generation !== this.generation) throw Error("连接已取消。");
    const url = new URL("/ws/v1/connect", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const transport = new AdaptiveTransport(url.href, {
      role: "client",
      deviceId: this.identity.deviceId,
      accessToken: this.credentials!.accessToken,
      targetDeviceId: host.deviceId,
      forceRelay: true,
      preferredTransports: ["relay"],
    });
    const core = new RemoteClientCore(
      new SecureTransport(transport, this.identity, host),
      35_000,
    );
    this.core = core;
    core.onClose(() => {
      if (this.core === core) {
        this.core = undefined;
        this.directoryReads = 0;
        this.onDirectoryLoading(false);
        this.onClosed();
      }
    });
    try {
      await core.connect();
      const features = await probeRemoteHostFeatures(core, host.clientVersion);
      if (!features.remoteGateway)
        throw Error("这台电脑不支持原生网页所需的 Remote 通信接口。");
      if (generation !== this.generation) throw Error("连接已取消。");
      const gateway = new RemoteTypertGateway(core);
      const directory = (delta: number) => {
        if (this.core !== core) return;
        this.directoryReads = Math.max(0, this.directoryReads + delta);
        this.onDirectoryLoading(this.directoryReads > 0);
      };
      return {
        async call(
          channel: string,
          endpoint: string,
          payload: unknown,
          signal?: AbortSignal,
        ) {
          if (channel !== "/api") throw Error("远程网页不能访问此本地接口。");
          const started = performance.now();
          if (import.meta.env.DEV) console.debug("[remote] call", endpoint);
          if (endpoint === "session/list") directory(1);
          let result;
          try {
            result = await gateway.dispatch(endpoint, payload, signal);
          } finally {
            if (endpoint === "session/list") directory(-1);
          }
          if (import.meta.env.DEV)
            console.debug(
              "[remote] complete",
              endpoint,
              Math.round(performance.now() - started),
            );
          if (!result.ok)
            console.warn(
              "[remote] request rejected",
              endpoint,
              result.error.code,
            );
          return result;
        },
        async *open(
          channel: string,
          endpoint: string,
          payload: unknown,
          signal: AbortSignal,
        ) {
          if (channel !== "/api") throw Error("远程网页不能访问此本地接口。");
          let stream;
          try {
            stream = await gateway.open(endpoint, payload, signal);
            yield* stream;
          } catch (error) {
            if (!signal.aborted)
              console.warn(
                "[remote] stream failed",
                endpoint,
                (error as Error).message,
              );
            throw error;
          } finally {
            await stream?.close();
          }
        },
      };
    } catch (error) {
      if (this.core === core) this.core = undefined;
      await core.close();
      throw error;
    }
  }
  async disconnect() {
    ++this.generation;
    const core = this.core;
    this.core = undefined;
    this.directoryReads = 0;
    this.onDirectoryLoading(false);
    await core?.close();
  }
  clear() {
    sessionStorage.removeItem("dsh-web-identity");
    this.identity = { deviceId: crypto.randomUUID(), ...generateKeyPair() };
    this.credentials = undefined;
  }
}
