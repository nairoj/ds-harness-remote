import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openLocalHost } from "./support";

test("tool approval can be rejected and allowed once in a new test session", async ({ page }) => {
  test.setTimeout(240_000);
  const frame = await openLocalHost(page);
  const target = String.raw`D:\Workspace\dsh-remote-web-client\.private\approval-${Date.now()}.txt`;
  await frame.getByRole("button", { name: "Choose workspace", exact: true }).click();
  await frame.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await expect(frame.locator('[data-composer-input][contenteditable="true"]')).toBeVisible({ timeout: 35_000 });
  await frame.getByRole("button", { name: /^Access mode, current:/ }).click();
  await frame.getByRole("menuitem", { name: /Read Only/ }).click();
  await expect(frame.getByRole("button", { name: "Access mode, current: Read Only", exact: true })).toBeVisible();
  await frame.locator("[data-composer-input]").fill(`这是远程审批测试。请先调用文件写入工具，尝试在 ${target} 创建内容为 approval-test 的文件。如果工具报告只读沙箱拒绝，请遵循其升级提示，对完全相同的操作发起一次 sandbox_permissions=workspace-write、justification=网页审批连通性测试 的升级申请。测试程序会在网页拒绝此申请；收到用户拒绝后立即停止，禁止再次尝试写入，也不要换其他工具。`);
  await frame.getByRole("button", { name: "Send message", exact: true }).click();
  try {
    await frame.getByRole("button", { name: "Reject", exact: true }).click({ timeout: 90_000 });
    await expect(frame.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    expect(existsSync(target)).toBe(false);
    await page.screenshot({ path: "test-results/approval-rejected.png", fullPage: true });
    await expect(frame.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0, { timeout: 30_000 });
    await frame.locator("[data-composer-input]").fill(`现在测试允许一次。请再次尝试在 ${target} 创建内容为 approval-test 的文件。先按当前只读权限调用一次；若被只读沙箱拒绝，按工具提示对完全相同的操作以 sandbox_permissions=workspace-write、justification=网页允许一次审批测试 发起一次升级申请。这次测试程序会点击允许一次，获准后只创建这个文件，然后停止。`);
    await frame.getByRole("button", { name: "Send message", exact: true }).click();
    await frame.getByRole("button", { name: "Allow once", exact: true }).click({ timeout: 90_000 });
    await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true);
    expect(readFileSync(target, "utf8").trim()).toBe("approval-test");
    await page.screenshot({ path: "test-results/approval-allowed.png", fullPage: true });
  } finally {
    const stop = frame.getByRole("button", { name: "Stop generating", exact: true });
    if (await stop.isVisible()) await stop.click();
    writeFileSync(".private/approval-snapshot.txt", await frame.locator("body").ariaSnapshot());
  }
});
