import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("existing login reports wrong password and clears the session on logout", async ({
  page,
}) => {
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
  const credentials = Object.fromEntries(
    env
      .trim()
      .split(/\r?\n/)
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  await page.goto("/");
  await page
    .getByLabel("账号", { exact: true })
    .fill(credentials.DSH_SERVER_ACCOUNT);
  await page
    .getByLabel("密码", { exact: true })
    .fill("wrong-password-for-test");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByRole("alert")).toContainText("账号或密码错误");
  await page
    .getByLabel("密码", { exact: true })
    .fill(credentials.DSH_SERVER_PASSWORD);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(
    page.getByRole("heading", { name: "连接你的电脑" }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage.includes(credentials.DSH_SERVER_PASSWORD)).toBe(false);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByLabel("账号", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("dsh-web-identity")),
  ).toBeNull();
  const response = await page.request.get("/api/v1/auth/me");
  expect(response.status()).toBe(401);
});
