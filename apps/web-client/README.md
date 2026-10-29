# DSH Remote Web

基于正在运行的 DSH `0.2.0-rc.2`。复用官方发布包的原生网页模块和已有单账号中继的登录组件/API，浏览器通过 Remote Noise IK 加密通道连接电脑。

```powershell
npm ci
node scripts/prepare-native.mjs
npm run dev
```

打开 `http://127.0.0.1:4174`。开发代理连接现有中继；不启动或重启本地 DSH。
`prepare-native.mjs` 默认读取本机安装的 DSH；其他机器可通过 `DSH_NODE_MODULES` 指向对应的 `node_modules/@deepseek-ai`，脚本强制检查版本。

验证：`npm run test:e2e`。真实冒烟：`node scripts/build-smoke.mjs` 后运行 `node .private/live-smoke.mjs`；该脚本通过已授权 SSH 读取认证信息，不输出秘密。验收范围见 `docs/acceptance.md`。

当前仍在开发，不能据此宣称全部功能可用。原生静态资源由构建脚本生成，不提交密码、浏览器密钥、设备 token 或现有会话数据。

当前 Host 的 Remote 接口不支持普通文件上传，页面会明确提示并阻止直接 HTTP 上传。已有工作区文件预览和独立终端已完成真实连接验证。验证范围和剩余限制见 `docs/verification.md`。

## 上游

- DSH 原生网页：`deepseek-ai/deepseek-harness`，标签 `dsh-v0.2.0-rc.2`，MIT；使用本机安装的对应发布资源。
- Remote 通信：`liguobao/ds-harness-remote`，标签 `v0.5.19`，MIT；固定来源记录在 `vendor/remote/SOURCE.json`。
- `src/secure-transport.ts` 来自同版本 Android SecureTransport，只调整环境依赖。
- `src/login` 来自同版本自部署 Server 的登录组件，保留原样。
