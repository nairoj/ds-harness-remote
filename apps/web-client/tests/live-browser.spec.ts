import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
function login() {
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
  return Object.fromEntries(
    env
      .trim()
      .split(/\r?\n/)
      .map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
  );
}
test("real relay login and native DSH boot", async ({ page }) => {
  page.setDefaultTimeout(15_000);
  const faults: string[] = [];
  page.on("pageerror", (e) => faults.push(e.message));
  page.on("response", (r) => {
    if (r.status() === 404)
      console.log("Missing resource:", new URL(r.url()).pathname);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("401 (Unauthorized)"))
      faults.push(msg.text().slice(0, 400));
  });
  page.on("console", (msg) => {
    if (msg.type() === "warning" && msg.text().startsWith("[remote]"))
      console.log(msg.text());
  });
  await page.goto("/");
  const credentials = login();
  await page
    .getByLabel("账号", { exact: true })
    .fill(credentials.DSH_SERVER_ACCOUNT);
  await page
    .getByLabel("密码", { exact: true })
    .fill(credentials.DSH_SERVER_PASSWORD);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(
    page.getByRole("heading", { name: "连接你的电脑" }),
  ).toBeVisible();
  const host = page.getByRole("button").filter({ hasText: "HIH-D-23754" });
  await expect(host).toBeEnabled();
  await host.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "信任并连接" }).click();
  await expect(page.getByTitle("DSH 工作区")).toBeVisible({ timeout: 45_000 });
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).not.toContainText(
    "window.__ModuleLoader__ bootstrap facade is missing",
  );
  await page.waitForTimeout(20_000);
  await expect(frame.getByRole("tree", { name: "Sessions" })).toBeVisible();
  await expect(
    frame.getByRole("button", { name: "Reconnecting, reconnect now" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/native-boot.png",
    fullPage: true,
  });
  console.log("Native boot errors:", JSON.stringify(faults));
  console.log(
    "Native boot body length:",
    await frame
      .locator("body")
      .innerText()
      .then((s) => s.length),
  );
  expect(faults).toEqual([]);
  await page.evaluate(() => {
    const global = window as any;
    const rpc = global.dshRemoteTransport.rpc;
    const call = rpc.call.bind(rpc);
    global.testCreatedSessions = [];
    rpc.call = async (
      channel: string,
      endpoint: string,
      payload: any,
      signal: AbortSignal,
    ) => {
      const id = payload?.args?.request?.sessionId;
      if (
        [
          "session/prompt",
          "session/cancel",
          "session/selectModel",
          "session/rename",
        ].includes(endpoint) &&
        !global.testCreatedSessions.includes(id)
      )
        throw Error("Test refused to modify an existing session");
      const result = await call(channel, endpoint, payload, signal);
      if (endpoint === "session/create" && result.ok)
        global.testCreatedSessions.push(result.value.sessionId);
      return result;
    };
  });
  await frame
    .getByRole("button", { name: "Choose workspace", exact: true })
    .click();
  await frame.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await expect(
    frame.locator('[data-composer-input][contenteditable="true"]'),
  ).toBeVisible({ timeout: 35_000 });
  const created = await page.evaluate(
    () => (window as any).testCreatedSessions,
  );
  expect(created).toHaveLength(1);
  writeFileSync(".private/test-sessions.json", JSON.stringify(created));
  await frame
    .locator("[data-composer-input]")
    .fill(
      "这是网页远程客户端的连通性测试。不要使用任何工具。请仅回复英文大写单词 WEB、CLIENT、OK，用下划线连接。",
    );
  await frame
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(frame.getByText("WEB_CLIENT_OK", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.screenshot({
    path: "test-results/model-reply.png",
    fullPage: true,
  });
  await frame
    .locator("[data-composer-input]")
    .fill("不要使用工具。请从1开始逐行数到1000，每行一个数字。");
  await frame
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await frame
    .getByRole("button", { name: "Stop generating", exact: true })
    .click({ timeout: 30_000 });
  await expect(
    frame.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "连接你的电脑" }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: "HIH-D-23754" }).click();
  await expect(page.getByTitle("DSH 工作区")).toBeVisible({ timeout: 45_000 });
  const restored = page.frameLocator("iframe");
  await expect(restored.getByRole("tree", { name: "Sessions" })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(async (id) => {
    const rpc = (window as any).dshRemoteTransport.rpc;
    const result = await rpc.call("/api", "session/rename", {
      args: {
        request: {
          sessionId: id,
          title: "Remote Web acceptance " + id.slice(-8),
        },
      },
    });
    if (!result.ok) throw Error("Could not name the test session");
  }, created[0]);
  await restored
    .getByRole("treeitem", { name: "Workspace", exact: true })
    .click();
  await restored
    .getByText("Remote Web acceptance " + created[0].slice(-8), { exact: true })
    .click({timeout:90_000});
  await expect(
    restored.getByText("WEB_CLIENT_OK", { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    restored.getByRole("button", { name: "Open sidebar", exact: true }),
  ).toBeVisible();
  await expect(restored.locator("[data-composer-input]")).toBeVisible();
  const overflow = await restored
    .locator("body")
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("reopen the dedicated test session and render at phone size", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.on("console", (m) => {
    if (m.text().startsWith("[remote]")) console.log(m.text());
  });
  const [sessionId] = JSON.parse(
    readFileSync(".private/test-sessions.json", "utf8"),
  );
  if (typeof sessionId !== "string" || !sessionId.startsWith("session-"))
    throw Error("No dedicated test session");
  const credentials = login();
  await page.goto("/");
  await page
    .getByLabel("账号", { exact: true })
    .fill(credentials.DSH_SERVER_ACCOUNT);
  await page
    .getByLabel("密码", { exact: true })
    .fill(credentials.DSH_SERVER_PASSWORD);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.getByRole("button").filter({ hasText: "HIH-D-23754" }).click();
  await page.getByRole("button", { name: "信任并连接" }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("tree", { name: "Sessions" })).toBeVisible({
    timeout: 45_000,
  });
  const title = "Remote Web acceptance " + sessionId.slice(-8);
  await page.evaluate(
    async ({ sessionId, title }) => {
      const result = await (window as any).dshRemoteTransport.rpc.call(
        "/api",
        "session/rename",
        { args: { request: { sessionId, title } } },
      );
      if (!result.ok) throw Error("Could not name the dedicated test session");
    },
    { sessionId, title },
  );
  await frame.getByRole("treeitem", { name: "Workspace", exact: true }).click();
  await frame.getByText(title, { exact: true }).click({ timeout: 90_000 });
  await expect(frame.getByText("WEB_CLIENT_OK", { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    frame.getByRole("button", { name: "Open sidebar", exact: true }),
  ).toBeVisible();
  await expect(frame.locator("[data-composer-input]")).toBeVisible();
  expect(
    await frame
      .locator("body")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
  ).toBe(false);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
