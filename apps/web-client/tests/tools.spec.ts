import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { openLocalHost } from "./support";

test("read this client's README through the encrypted workspace browser", async ({
  page,
}) => {
  const frame = await openLocalHost(page);
  await frame
    .getByRole("button", { name: "Choose workspace", exact: true })
    .click();
  await frame.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await expect(
    frame.locator('[data-composer-input][contenteditable="true"]'),
  ).toBeVisible({ timeout: 35_000 });
  await frame
    .getByRole("button", { name: "Open right sidebar", exact: true })
    .click();
  await frame.getByRole("button", { name: /^Workspace files Browse/ }).click();
  await frame.getByText("dsh-remote-web-client", { exact: true }).click();
  await frame.getByText("README.md", { exact: true }).click();
  await expect(
    frame.getByText("DSH Remote Web", { exact: true }),
  ).toBeVisible();
  writeFileSync(
    ".private/native-tools.txt",
    await frame.locator("body").ariaSnapshot(),
  );
  await page.screenshot({ path: "test-results/tools.png", fullPage: true });
});

test("a terminal created in a new session can echo and close", async ({
  page,
}) => {
  const frame = await openLocalHost(page);
  await page.evaluate(() => {
    const global = window as any;
    const rpc = global.dshRemoteTransport.rpc;
    const call = rpc.call.bind(rpc),
      open = rpc.open.bind(rpc);
    global.testTerminals = [];
    global.testTerminalOutput = "";
    rpc.call = async (
      channel: string,
      endpoint: string,
      payload: any,
      signal: AbortSignal,
    ) => {
      const result = await call(channel, endpoint, payload, signal);
      if (endpoint === "terminal/create" && result.ok) {
        global.testTerminals.push({
          agentId: payload.args.agentId,
          id: payload.args.request.id,
        });
        global.testTerminalShell = result.value.shell.path;
      }
      return result;
    };
    rpc.open = async function* (
      channel: string,
      endpoint: string,
      ...args: any[]
    ) {
      for await (const item of open(channel, endpoint, ...args)) {
        if (endpoint === "terminal/follow")
          global.testTerminalOutput += item.screen ?? item.data ?? "";
        yield item;
      }
    };
  });
  try {
    await frame
      .getByRole("button", { name: "Choose workspace", exact: true })
      .click();
    await frame
      .getByRole("menuitem", { name: "Workspace", exact: true })
      .click();
    await expect(
      frame.locator('[data-composer-input][contenteditable="true"]'),
    ).toBeVisible({ timeout: 35_000 });
    await frame
      .getByRole("button", { name: "Open right sidebar", exact: true })
      .click();
    await frame
      .getByRole("button", { name: /^New terminal Run commands/ })
      .click();
    const terminal = frame.getByRole("textbox", {
      name: "Terminal",
      exact: true,
    });
    await expect(terminal).toBeEditable({ timeout: 35_000 });
    const command = await page.evaluate(() =>
      String((window as any).testTerminalShell)
        .toLowerCase()
        .endsWith("cmd.exe")
        ? "echo REMOTE_TERMINAL_O^K"
        : 'echo REMOTE_"TERMINAL_OK"',
    );
    await terminal.pressSequentially(command);
    await terminal.press("Enter");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as any).testTerminalOutput.includes("REMOTE_TERMINAL_OK"),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.screenshot({
      path: "test-results/terminal.png",
      fullPage: true,
    });
  } finally {
    const closed = await page.evaluate(async () => {
      const global = window as any;
      const results = [];
      for (const target of global.testTerminals)
        results.push(
          await global.dshRemoteTransport.rpc.call("/api", "terminal/close", {
            args: target,
          }),
        );
      return results.every((result) => result.ok);
    });
    expect(closed).toBe(true);
  }
});
