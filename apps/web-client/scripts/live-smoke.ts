import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { generateKeyPair } from "@dsh-remote/crypto";
import { RelayTransport } from "@dsh-remote/webrtc";
import {
  RemoteClientCore,
  RemoteTypertGateway,
  probeRemoteHostFeatures,
} from "@dsh-remote/client-core";
import { SecureTransport } from "../src/secure-transport";
import type { DeviceIdentity, RemoteDevice } from "../src/types";

const base = "https://47.102.38.163";
mkdirSync(".private", { recursive: true });
// Only the SSH transport sees the server config. Never print values or API bodies.
const env = execFileSync(
  "ssh.exe",
  [
    "-i",
    String.raw`C:\Users\chenweijie05\.ssh\id_rsa`,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "cwj@47.102.38.163",
    "sudo cat /opt/dsh-remote/.env",
  ],
  { encoding: "utf8" },
);
const values = Object.fromEntries(
  env
    .trim()
    .split(/\r?\n/)
    .map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
);
async function api(path: string, body?: unknown, token?: string) {
  const response = await fetch(base + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API ${path}: HTTP ${response.status}`);
  return response.json() as Promise<any>;
}
const auth = await api("/auth/login", {
  email: values.DSH_SERVER_ACCOUNT,
  password: values.DSH_SERVER_PASSWORD,
});
const identity: DeviceIdentity = existsSync(".private/test-identity.json")
  ? JSON.parse(readFileSync(".private/test-identity.json", "utf8"))
  : { deviceId: crypto.randomUUID(), ...generateKeyPair() };
writeFileSync(".private/test-identity.json", JSON.stringify(identity), {
  mode: 0o600,
});
const credentials = await api(
  "/devices/register",
  {
    v: 1,
    device: {
      deviceId: identity.deviceId,
      name: "Web client acceptance",
      role: "client",
      platform: "browser",
      identityKey: identity.publicKey,
      clientVersion: "0.5.19",
    },
  },
  auth.token,
);
const { items } = await api("/devices", undefined, credentials.accessToken);
const results = [];
for (const item of items.filter(
  (x: RemoteDevice) =>
    x.online && ["HIH-D-23754", "DESKTOP-S06SS24"].includes(x.name),
) as RemoteDevice[]) {
  const host: RemoteDevice = await api(
    "/devices/" + encodeURIComponent(item.deviceId),
    undefined,
    credentials.accessToken,
  );
  const transport = new RelayTransport(
    base.replace("https:", "wss:") + "/ws/v1/connect",
    {
      role: "client",
      deviceId: identity.deviceId,
      accessToken: credentials.accessToken,
      targetDeviceId: host.deviceId,
    },
  );
  const core = new RemoteClientCore(
    new SecureTransport(transport, identity, host),
    20_000,
  );
  let stage = "handshake";
  try {
    await core.connect();
    stage = "features";
    const features = await probeRemoteHostFeatures(core, host.clientVersion);
    if (!features.remoteGateway)
      throw Error("Host has no native Remote gateway");
    stage = "workspaces";
    const gateway = new RemoteTypertGateway(core);
    const stream = await gateway.open("workspace/follow", { args: {} });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("Workspace baseline timeout")), 20_000),
      ),
    ]);
    if (first.done) throw Error("Missing workspace baseline");
    await stream.close();
    stage = "sessions";
    const sessions = await gateway.call<any>("session/list", {
      args: { _request: {} },
    });
    const result = {
      host: host.name,
      harnessVersion: host.harnessVersion,
      pluginVersion: host.clientVersion,
      encrypted: true,
      workspaceBaselineType: (first.value as any)?.type,
      sessionCount: sessions.items?.length,
      passed: true,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = {
      host: host.name,
      stage,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    await core.close();
  }
}
writeFileSync(
  "docs/live-smoke-result.json",
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n",
);
if (results.length !== 1 || results.some((r) => !r.passed))
  process.exitCode = 1;
