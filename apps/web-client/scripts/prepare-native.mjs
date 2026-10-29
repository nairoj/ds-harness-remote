import { readdir, readFile, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
const root =
  process.env.DSH_NODE_MODULES ??
  join(
    process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
    "npm",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "node_modules",
    "@deepseek-ai",
  );
const { bootInjections, orderByModuleGraph } = await import(
  pathToFileURL(join(root, "dsh-client-modules/lib/index.js")).href
);
const output = "public/native";
const generated = resolve(output);
if (generated !== join(process.cwd(), "public", "native"))
  throw Error("Invalid generated native directory");
await rm(generated, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, "dsh-web-frontend/dist"), output, { recursive: true });
const entries = [];
for (const folder of await readdir(root)) {
  let p;
  try {
    p = JSON.parse(await readFile(join(root, folder, "package.json"), "utf8"));
  } catch {
    continue;
  }
  const client = p.dsh?.client;
  if (
    client?.platform !== "web" ||
    [
      "dsh-client-hmr",
      "dsh-client-product-analytics",
      "dsh-client-ui-directory-picker-native",
      "dsh-cordis-client-runner",
      "dsh-client-ui-cordis",
      "dsh-client-ui-open-in-app",
      "dsh-experimental-client-ui-voice-input",
    ].includes(folder)
  )
    continue;
  if (p.version !== "0.2.0-rc.2")
    throw Error(
      "Unexpected native package version: " + p.name + "@" + p.version,
    );
  const lib = join(root, folder, "lib");
  let source;
  try {
    source = await readFile(join(lib, "client.js"), "utf8");
  } catch {
    continue;
  }
  const rev = createHash("sha256").update(source).digest("hex").slice(0, 16);
  await mkdir(join(output, "plugins", p.name), { recursive: true });
  for (const file of await readdir(lib))
    if (/^client.*\.(js|css)$/.test(file))
      await cp(join(lib, file), join(output, "plugins", p.name, file));
  // The stock module loader's chunk resolver expects the published combo URL shape.
  entries.push({
    id: p.name,
    url: `/native/plugins/??${p.name}/client.js&rev=${rev}`,
    rev,
    inject: client.inject ?? [],
    external: client.external ?? [],
    immediately: client.immediately === true,
  });
}
const cachePlugin = await readFile("src/native-cache-plugin.js", "utf8");
const cacheRev = createHash("sha256")
  .update(cachePlugin)
  .digest("hex")
  .slice(0, 16);
await mkdir(join(output, "plugins", "dsh-remote-web-cache"), {
  recursive: true,
});
await writeFile(
  join(output, "plugins", "dsh-remote-web-cache", "client.js"),
  cachePlugin,
);
entries.push({
  id: "dsh-remote-web-cache",
  url: `/native/plugins/??dsh-remote-web-cache/client.js&rev=${cacheRev}`,
  rev: cacheRev,
  inject: [
    "@deepseek-ai/dsh-api-remotes",
    "@deepseek-ai/dsh-api-session-controller",
    "@deepseek-ai/dsh-api-workspace-controller",
    "@deepseek-ai/dsh-api-workspace-files",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
    "@deepseek-ai/dsh-client-ui-sidebar-right",
    "@deepseek-ai/dsh-client-ui-workspace",
  ],
  external: [],
  immediately: false,
});
const pluginVersion = createHash("sha256")
  .update(JSON.stringify(entries.map((entry) => [entry.id, entry.rev])))
  .digest("hex")
  .slice(0, 16);
await cp(
  join(output, "plugins"),
  join(output, "versions", pluginVersion, "plugins"),
  { recursive: true },
);
for (const entry of entries)
  entry.url = entry.url.replace(
    "/native/plugins/",
    `/native/versions/${pluginVersion}/plugins/`,
  );
await rm(join(generated, "plugins"), { recursive: true, force: true });
const ordered = orderByModuleGraph(entries);
const graph = {
  rev: "dsh-0.2.0-rc.2",
  entries: ordered,
  batches: ordered.map((e) => ({
    phase:
      e.id === "@deepseek-ai/dsh-client-modules" ? "bootstrap" : "application",
    url: e.url,
    rev: e.rev,
    entries: [e.id],
  })),
};
const escape = (s) => s.replaceAll("</script", "<\\/script");
const assetUrl = (url) => url.replace("/??", "/").replace("&rev=", "?rev=");
const injections = bootInjections(graph)
  .map((r) =>
    r.kind === "script"
      ? `<script>${escape(r.text)}</script>`
      : r.kind === "script-src"
        ? `<script src="${assetUrl(r.src)}"></script>`
        : r.kind === "global"
          ? `<script>window[${JSON.stringify(r.name)}]=${escape(JSON.stringify(r.value))}</script>`
          : "",
  )
  .join("\n");
let html = await readFile(join(output, "index.html"), "utf8");
const bridge = `<script>
if(!parent.dshRemoteTransport?.rpc)throw new Error('请先从 Remote 选择并连接电脑。');
window.__DSH_FILE_UPLOAD__={fetch(){
 parent.dshRemoteTransport.onUnsupportedUpload?.();
 return Promise.reject(new Error('当前电脑的 Remote 接口不支持文件上传。'));
}};
window.__DSH_TRANSPORT__={
 loadBundle(url){return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=url.replace('/??','/').replace('&rev=','?rev=');
  script.onload=()=>{script.remove();resolve()};
  script.onerror=()=>{script.remove();reject(new Error('原生页面模块加载失败'))};
  document.head.append(script);
 })},
 rpc:{
 async call(...args){return structuredClone(await parent.dshRemoteTransport.rpc.call(...args))},
 async *open(...args){
  try{for await(const item of parent.dshRemoteTransport.rpc.open(...args))yield structuredClone(item)}
  catch(error){throw new Error(error.message)}
 }
}};
</script>`;
html = html.replace("<head>", "<head>\n" + bridge + "\n" + injections);
html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/,
  (_tag, src) =>
    `<script type="module">if(window.__DSH_TRANSPORT__?.rpc){await import(${JSON.stringify(src)})}else{location.replace('/')}</script>`,
);
await writeFile(join(output, "index.html"), html);
await writeFile(join(output, "graph.json"), JSON.stringify(graph));
const resources = {};
async function collect(dir, prefix) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name),
      url = prefix + "/" + item.name;
    if (item.isDirectory()) await collect(path, url);
    else if (/\.(js|css|woff2?|svg|png|webp)$/.test(item.name))
      resources[url] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
}
await collect(output, "/native");
const resourceVersion = createHash("sha256")
  .update(JSON.stringify(resources))
  .digest("hex")
  .slice(0, 16);
await writeFile(
  "public/resource-sw.js",
  `
const VERSION=${JSON.stringify(resourceVersion)}, FILES=${JSON.stringify(resources)};
const NAME='dsh-resources-'+VERSION;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('dsh-resources-')&&key!==NAME)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),rev=FILES[url.pathname];
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!rev)return;
 event.respondWith((async()=>{
  const cache=await caches.open(NAME),key=url.origin+url.pathname+'?resourceVersion='+rev;
  const saved=await cache.match(key);if(saved)return saved;
  const response=await fetch(event.request,{cache:'no-cache'});
  if(response.ok)try{await cache.put(key,response.clone())}catch{}
  return response;
 })());
});
`,
);
console.log(`Prepared ${ordered.length} native DSH 0.2.0-rc.2 modules.`);
