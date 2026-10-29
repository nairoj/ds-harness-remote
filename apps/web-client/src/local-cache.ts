export interface ReadingPosition {
  anchorKey?: string;
  anchorTop?: number;
  scrollTop: number;
  tail: boolean;
  firstSeq?: number;
}
export interface RecentSession {
  position?: ReadingPosition;
  updatedAt: number;
}
interface CacheData {
  version: 2;
  directory?: any;
  current?: string;
  recent: Record<string, RecentSession>;
}
const PREFIX = "dsh-web-cache-v1:";
const LAST_HOST_PREFIX = "dsh-web-last-host:";
const NATIVE_CURRENT_SESSION_KEY = "dsh.sessions.current";
const MAX_RECENT = 10;

export function syncNativeCurrentSession(sessionId?: string) {
  try {
    if (sessionId)
      localStorage.setItem(
        NATIVE_CURRENT_SESSION_KEY,
        JSON.stringify({ sessionId }),
      );
    else localStorage.removeItem(NATIVE_CURRENT_SESSION_KEY);
  } catch {
    /* quota/private mode */
  }
}

export function getLastHost(account: string): string | null {
  try {
    return localStorage.getItem(LAST_HOST_PREFIX + account);
  } catch {
    return null;
  }
}

export function setLastHost(account: string, deviceId?: string) {
  try {
    if (deviceId) localStorage.setItem(LAST_HOST_PREFIX + account, deviceId);
    else localStorage.removeItem(LAST_HOST_PREFIX + account);
  } catch {
    /* quota/private mode */
  }
}

/** Only navigation and reading positions are persisted; never RPC envelopes, message bodies, or live controls. */
export class LocalCache {
  readonly key: string;
  private active = true;
  private data: CacheData = { version: 2, recent: {} };
  constructor(account: string, deviceId: string, identityKey: string) {
    this.key = PREFIX + JSON.stringify([account, deviceId, identityKey]);
    try {
      const value = JSON.parse(localStorage.getItem(this.key) ?? "null");
      if (
        (value?.version === 2 || value?.version === 1) &&
        value.recent &&
        typeof value.recent === "object"
      ) {
        const recent: Record<string, RecentSession> = {};
        for (const [id, item] of Object.entries<any>(value.recent)) {
          if (item && typeof item === "object") {
            recent[id] = {
              position: item.position,
              updatedAt:
                typeof item.updatedAt === "number" ? item.updatedAt : 0,
            };
          }
        }
        this.data = {
          version: 2,
          directory: value.directory,
          current:
            typeof value.current === "string" ? value.current : undefined,
          recent,
        };
      }
    } catch {
      /* An unavailable or damaged cache must not block the live connection. */
    }
  }
  get directory() {
    return this.data.directory;
  }
  get current() {
    return this.data.current;
  }
  recent(id: string) {
    return this.data.recent[id];
  }
  recentIds(): string[] {
    return Object.entries(this.data.recent)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .map(([id]) => id);
  }
  select(id: string) {
    this.data.current = id;
    this.data.recent[id] = {
      ...this.data.recent[id],
      updatedAt: Date.now(),
    };
    const oldest = Object.entries(this.data.recent)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(MAX_RECENT);
    for (const [key] of oldest) delete this.data.recent[key];
    this.save();
  }
  storeDirectory(value: any) {
    if (!Array.isArray(value?.items)) return;
    this.data.directory = {
      items: value.items.map((row: any) => ({
        sessionId: row.sessionId,
        cwd: row.cwd,
        parentSessionId: row.parentSessionId,
        origin: row.origin,
        updatedAt: row.updatedAt,
        blank: false,
        running: false,
        agentAvailable: false,
        ...(row.projections?.values?.title === undefined
          ? {}
          : {
              projections: {
                kind: "cached",
                asOfSeq: row.projections.asOfSeq,
                values: { title: row.projections.values.title },
              },
            }),
      })),
    };
    const ids = new Set(value.items.map((row: any) => row.sessionId));
    for (const id of Object.keys(this.data.recent))
      if (!ids.has(id)) delete this.data.recent[id];
    if (this.data.current && !ids.has(this.data.current))
      delete this.data.current;
    this.save();
  }
  storePosition(id: string, position: ReadingPosition) {
    this.data.recent[id] = {
      ...this.data.recent[id],
      position,
      updatedAt: Date.now(),
    };
    const oldest = Object.entries(this.data.recent)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(MAX_RECENT);
    for (const [key] of oldest) delete this.data.recent[key];
    this.save();
  }
  close() {
    this.active = false;
  }
  private save() {
    if (!this.active) return;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* quota/private mode */
    }
  }
}

export async function clearLocalCaches() {
  for (const key of Object.keys(localStorage))
    if (
      key.startsWith(PREFIX) ||
      key.startsWith(LAST_HOST_PREFIX) ||
      key === NATIVE_CURRENT_SESSION_KEY
    )
      localStorage.removeItem(key);
  if ("caches" in window)
    for (const key of await caches.keys())
      if (key.startsWith("dsh-resources-")) await caches.delete(key);
}

/** One stale list delivery, one background read, then the native controller refreshes from that read. */
export function cachedDirectoryRpc(
  rpc: any,
  cache: LocalCache,
  changed: (state: "cached" | "fresh" | "error") => void,
) {
  let initial = true;
  let active = true;
  let pending: Promise<any> | undefined;
  let notify: (() => void) | undefined;
  let result: any;
  let collecting = false;
  let mutations: any[] = [];
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let startBackgroundRefresh: (() => void) | undefined;
  const deliver = (value: any) => {
    if (value.ok) {
      let items = value.value.items;
      for (const frame of mutations) {
        const [id, running] = frame.args;
        if (frame.event === "api-session/status")
          items = items.map((row: any) =>
            row.sessionId === id
              ? { ...row, running, agentAvailable: true }
              : row,
          );
        if (frame.event === "api-session/activity")
          items = items.map((row: any) =>
            row.sessionId === id ? { ...row, updatedAt: running } : row,
          );
        if (frame.event === "api-session/removed")
          items = items.filter((row: any) => row.sessionId !== id);
        if (frame.event === "api-session/added")
          items = [
            ...items.filter((row: any) => row.sessionId !== id.sessionId),
            id,
          ];
      }
      value = { ...value, value: { ...value.value, items } };
      if (active) {
        cache.storeDirectory(value.value);
        changed("fresh");
      }
    } else if (active) changed("error");
    collecting = false;
    mutations = [];
    return value;
  };
  const bridge = {
    set onDirectoryUpdated(callback: () => void) {
      notify = callback;
      if (result && active) callback();
    },
    triggerBackgroundRefresh() {
      startBackgroundRefresh?.();
    },
    close() {
      active = false;
      collecting = false;
      mutations = [];
      result = undefined;
      notify = undefined;
      startBackgroundRefresh = undefined;
      clearTimeout(refreshTimer);
      cache.close();
    },
    ...rpc,
    async *open(
      channel: string,
      endpoint: string,
      payload: any,
      signal: AbortSignal,
    ) {
      for await (const frame of rpc.open(channel, endpoint, payload, signal)) {
        if (
          collecting &&
          endpoint === "$events" &&
          frame.type === "emit" &&
          [
            "api-session/status",
            "api-session/activity",
            "api-session/removed",
            "api-session/added",
          ].includes(frame.event)
        )
          mutations.push(frame);
        yield frame;
      }
    },
    async call(
      channel: string,
      endpoint: string,
      payload: any,
      signal?: AbortSignal,
    ) {
      if (endpoint !== "session/list" || channel !== "/api")
        return rpc.call(channel, endpoint, payload, signal);
      if (result) {
        const value = result;
        result = undefined;
        pending = undefined;
        return deliver(value);
      }
      if (initial && cache.directory) {
        initial = false;
        collecting = true;
        changed("cached");
        startBackgroundRefresh = () => {
          if (!active || pending) return;
          clearTimeout(refreshTimer);
          startBackgroundRefresh = undefined;
          pending = rpc
            .call(channel, endpoint, payload, signal)
            .then((value: any) => {
              if (!active) return value;
              result = value;
              notify?.();
              return value;
            })
            .catch((error: unknown) => {
              collecting = false;
              mutations = [];
              if (active) changed("error");
              return {
                ok: false,
                error: {
                  code: "cache/refresh-failed",
                  message: String(error),
                  details: {},
                },
              };
            });
        };
        refreshTimer = setTimeout(() => startBackgroundRefresh?.(), 15_000);
        return { ok: true, value: cache.directory };
      }
      initial = false;
      startBackgroundRefresh?.();
      if (pending) {
        const value = await pending;
        pending = undefined;
        result = undefined;
        return deliver(value);
      }
      const value = await rpc.call(channel, endpoint, payload, signal);
      if (active && value.ok) {
        cache.storeDirectory(value.value);
        changed("fresh");
      } else if (active) changed("error");
      return value;
    },
  };
  return bridge;
}
