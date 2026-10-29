import { fileURLToPath } from "node:url";
export const aliases = Object.fromEntries(
  ["protocol", "crypto", "webrtc", "client-core"].map((name) => [
    `@dsh-remote/${name}`,
    fileURLToPath(
      new URL(`../vendor/remote/${name}/src/index.ts`, import.meta.url),
    ),
  ]),
);
