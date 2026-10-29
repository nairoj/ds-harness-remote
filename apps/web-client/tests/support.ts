import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";

export function credentials() {
  const env = execFileSync(
    "ssh.exe",
    [
      "-i",
      String.raw`C:\Users\chenweijie05\.ssh\id_rsa`,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "cwj@47.102.38.163",
      "sudo cat /opt/dsh-remote/.env",
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  return Object.fromEntries(
    env
      .trim()
      .split(/\r?\n/)
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
}

export async function openLocalHost(page: Page) {
  const account = credentials();
  await page.goto("/");
  await page
    .getByLabel("账号", { exact: true })
    .fill(account.DSH_SERVER_ACCOUNT);
  await page
    .getByLabel("密码", { exact: true })
    .fill(account.DSH_SERVER_PASSWORD);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.getByRole("button").filter({ hasText: "HIH-D-23754" }).click();
  await page.getByRole("button", { name: "信任并连接" }).click();
  const frame = page.frameLocator("iframe");
  await expect(page.getByTitle("DSH 工作区")).toBeVisible({
    timeout: 45_000,
  });
  return frame;
}
