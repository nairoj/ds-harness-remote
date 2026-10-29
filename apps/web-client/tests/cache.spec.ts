import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openLocalHost } from "./support";

test("cached catalog and recent history restore while a live directory refresh is pending", async ({
  page,
}) => {
  const faults: string[] = [];
  page.on("pageerror", (e) => faults.push(e.message));
  const [id] = JSON.parse(readFileSync(".private/test-sessions.json", "utf8"));
  await openLocalHost(page);
  await page.waitForFunction(
    () => typeof (window.dshRemoteTransport as any)?.openSession === "function",
    { timeout: 45000 },
  );
  await page.evaluate(
    (id) => (window.dshRemoteTransport as any).openSession(id),
    id,
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("WEB_CLIENT_OK", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window.dshRemoteTransport as any).cache.directory?.items.length ??
            0,
        ),
      { timeout: 120000 },
    )
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 500 });
  const reading = frame.locator("[data-conversation-scroll]");
  await reading.evaluate((node) => {
    node.scrollTop = 25;
    node.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window.dshRemoteTransport as any).cache.recent(id)?.position !==
          undefined,
        id,
      ),
    )
    .toBe(true);
  const position = await page.evaluate(
    (id) => (window.dshRemoteTransport as any).cache.recent(id).position,
    id,
  );
  expect(position.scrollTop).toBeGreaterThan(0);
  expect(position.tail).toBe(false);
  await page.reload();
  await expect(page.getByTitle("DSH 工作区")).toBeVisible({ timeout: 25000 });
  await expect(frame.getByText("WEB_CLIENT_OK", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect
    .poll(() => reading.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  expect(
    Math.abs(
      (await reading.evaluate((node) => node.scrollTop)) - position.scrollTop,
    ),
  ).toBeLessThan(15);
  await expect
    .poll(() =>
      page.evaluate(() => (window.dshRemoteTransport as any).cache.current),
    )
    .toBe(id);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.dshRemoteTransport as any).retainedSessionIds?.().length ?? 0,
      ),
    )
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(
      (id) =>
        (window.dshRemoteTransport as any).retainedSessionIds?.().includes(id),
      id,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  const filesEntry = frame.locator('[data-guide-entry="files"]');
  if (await filesEntry.isVisible().catch(() => false)) {
    await filesEntry.click();
  }
  await page.evaluate(
    (id) =>
      (window.dshRemoteTransport as any).openFile(
        id,
        "dsh-remote-web-client/package.json",
      ),
    id,
  );
  const downloadBtn = frame.locator('[data-remote-download="header"]');
  await expect(downloadBtn).toBeVisible({ timeout: 30000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await downloadBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("package.json");
  expect(faults).toEqual([]);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: /登\s*录/ })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) =>
          k.startsWith("dsh-web-cache-") || k.startsWith("dsh-web-last-host:"),
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).filter((k) => k.startsWith("dsh-resources-")),
    ),
  ).toEqual([]);
});

test("cache isolates identities and drops live state; a closed writer cannot repopulate cleared storage", async ({
  page,
}) => {
  await page.goto("/");
  const values = await page.evaluate(async () => {
    const modulePath = "/src/local-cache.ts";
    const {
      LocalCache,
      clearLocalCaches,
      cachedDirectoryRpc,
      getLastHost,
      setLastHost,
    } = await import(modulePath);
    await clearLocalCaches();
    setLastHost("a", "host1");
    const a = new LocalCache("a", "host1", "key1");
    a.storeDirectory({
      items: [
        {
          sessionId: "s",
          running: true,
          agentAvailable: true,
          projections: {
            kind: "sequenced",
            asOfSeq: 1,
            values: {
              title: "title",
              permissions: { pending: ["old"] },
              notification: { running: true },
            },
          },
        },
      ],
    });
    a.select("s");
    a.storePosition("s", { scrollTop: 20, tail: false });
    let resolve: any;
    let calls = 0;
    let refresh = 0;
    const pending = new Promise((r) => (resolve = r));
    const rpc = cachedDirectoryRpc(
      {
        call: () => {
          calls++;
          return pending;
        },
      },
      a,
      () => {},
    );
    rpc.onDirectoryUpdated = () => {
      refresh++;
    };
    const first = await rpc.call("/api", "session/list", {});
    rpc.triggerBackgroundRefresh();
    resolve({ ok: true, value: { items: [] } });
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    const next = await rpc.call("/api", "session/list", {});
    const b = new LocalCache("b", "host1", "key1"),
      c = new LocalCache("a", "host2", "key1"),
      d = new LocalCache("a", "host1", "key2");
    const lastBeforeClear = [getLastHost("a"), getLastHost("b")];
    rpc.close();
    await clearLocalCaches();
    a.select("s");
    return {
      first,
      next,
      calls,
      refresh,
      lastBeforeClear,
      lastAfterClear: getLastHost("a"),
      isolated: [b.directory, c.directory, d.directory],
      keys: Object.keys(localStorage).filter(
        (k) =>
          k.startsWith("dsh-web-cache-") || k.startsWith("dsh-web-last-host:"),
      ),
    };
  });
  expect(values.first.value.items[0]).toMatchObject({
    running: false,
    agentAvailable: false,
  });
  expect(Object.keys(values.first.value.items[0].projections.values)).toEqual([
    "title",
  ]);
  expect(values.next.value.items).toEqual([]);
  expect(values.calls).toBe(1);
  expect(values.refresh).toBe(1);
  expect(values.lastBeforeClear).toEqual(["host1", null]);
  expect(values.lastAfterClear).toBeNull();
  expect(values.isolated).toEqual([undefined, undefined, undefined]);
  expect(values.keys).toEqual([]);
});

test("background directory delivery preserves newer live status and removals", async ({
  page,
}) => {
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const path = "/src/local-cache.ts";
    const { LocalCache, cachedDirectoryRpc } = await import(path);
    const cache = new LocalCache("mutation-test", "host", "key");
    cache.storeDirectory({
      items: [{ sessionId: "s" }, { sessionId: "removed" }],
    });
    let resolve: any;
    const pending = new Promise((r) => (resolve = r));
    const rpc = cachedDirectoryRpc(
      {
        call: () => pending,
        async *open() {
          yield {
            type: "emit",
            event: "api-session/status",
            args: ["s", true],
          };
          yield {
            type: "emit",
            event: "api-session/removed",
            args: ["removed"],
          };
        },
      },
      cache,
      () => {},
    );
    await rpc.call("/api", "session/list", {});
    for await (const _frame of rpc.open(
      "/api",
      "$events",
      {},
      new AbortController().signal,
    )) {
    }
    resolve({
      ok: true,
      value: {
        items: [
          { sessionId: "s", running: false },
          { sessionId: "removed", running: true },
        ],
      },
    });
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    const result = await rpc.call("/api", "session/list", {});
    return { result, persisted: cache.directory };
  });
  expect(state.result.value.items).toEqual([
    { sessionId: "s", running: true, agentAvailable: true },
  ]);
  expect(state.persisted.items).toHaveLength(1);
  expect(state.persisted.items[0].running).toBe(false);
});

test("production plugin resources are versioned and available from cache without network", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !baseURL?.includes("4175") && !baseURL?.includes(":5555"),
    "Service worker runs in production builds",
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const url = await page.evaluate(async () => {
    const graph = await (await fetch("/native/graph.json")).json();
    return graph.entries[0].url.replace("/??", "/").replace("&rev=", "?rev=");
  });
  expect(url).toMatch(/\/native\/versions\/[a-f0-9]+\/plugins\//);
  const first = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { ok: r.ok, text: await r.text() };
  }, url);
  expect(first.ok).toBe(true);
  await context.setOffline(true);
  const second = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { ok: r.ok, text: await r.text() };
  }, url);
  expect(second).toEqual(first);
  await context.setOffline(false);
  const paths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const key of await caches.keys())
      if (key.startsWith("dsh-resources-"))
        for (const r of await (await caches.open(key)).keys())
          paths.push(new URL(r.url).pathname);
    return paths;
  });
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.every((path) => path.startsWith("/native/"))).toBe(true);
});
