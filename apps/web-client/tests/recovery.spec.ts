import { test, expect } from "@playwright/test";
import { openLocalHost } from "./support";

test("replacing a closed carrier clears the old directory loading state", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args);
        if (String(args[0]).includes("/ws/v1/connect")) (window as any).testCarrier = socket;
        return socket;
      },
    });
  });
  await openLocalHost(page);
  const loading = page.getByRole("status").filter({ hasText: "正在读取会话目录" });
  await expect(loading).toBeVisible();
  await page.evaluate(() => (window as any).testCarrier.close(1000, "acceptance test"));
  await expect(page.getByRole("alert")).toContainText("连接已断开");
  await page.getByRole("button").filter({ hasText: "HIH-D-23754" }).click();
  await expect(page.getByTitle("DSH 工作区")).toBeVisible({ timeout: 45_000 });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("network recovery does not replay a prompt", async ({ page, context }) => {
  test.setTimeout(180_000);
  const frame = await openLocalHost(page);
  await page.evaluate(() => {
    const rpc = (window as any).dshRemoteTransport.rpc;
    const call = rpc.call.bind(rpc);
    (window as any).testPromptCount = 0;
    (window as any).testSessionIds = [];
    rpc.call = async (channel: string, endpoint: string, payload: any, signal: AbortSignal) => {
      if (endpoint === "session/prompt") {
        if (!(window as any).testSessionIds.includes(payload?.args?.request?.sessionId)) throw Error("Refused to prompt an existing session");
        (window as any).testPromptCount++;
      }
      const result = await call(channel, endpoint, payload, signal);
      if (endpoint === "session/create" && result.ok) (window as any).testSessionIds.push(result.value.sessionId);
      return result;
    };
  });
  await frame.getByRole("button", { name: "Choose workspace", exact: true }).click();
  await frame.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await expect(frame.locator('[data-composer-input][contenteditable="true"]')).toBeVisible({ timeout: 35_000 });
  await frame.locator("[data-composer-input]").fill("这是断网恢复测试。不要使用工具。请仅回复英文大写单词 OFFLINE、CLIENT、OK，用下划线连接。");
  await frame.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testPromptCount)).toBe(1);
  try {
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(frame.getByRole("button", { name: "Disconnected, reconnect now", exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.setOffline(false);
  }
  await expect(frame.getByRole("button", { name: "Disconnected, reconnect now", exact: true })).toHaveCount(0, { timeout: 35_000 });
  await expect(frame.getByText("OFFLINE_CLIENT_OK", { exact: true })).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() => (window as any).testPromptCount)).toBe(1);
  await page.screenshot({ path: "test-results/recovered.png", fullPage: true });
});
