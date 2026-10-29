import { test, expect } from "@playwright/test";
import { openLocalHost } from "./support";

test("unsupported file uploads never fall back to plaintext HTTP", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("uploadFileBinary"))
      uploads.push(request.url());
  });
  const frame = await openLocalHost(page);
  await frame
    .getByRole("button", { name: "Choose workspace", exact: true })
    .click();
  await frame.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await expect(
    frame.locator('[data-composer-input][contenteditable="true"]'),
  ).toBeVisible({ timeout: 35_000 });
  await frame.locator('input[type="file"]').setInputFiles({
    name: "remote-upload-test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Encrypted transport acceptance fixture"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "当前电脑的 Remote 接口不支持文件上传。",
  );
  expect(uploads).toEqual([]);
});
