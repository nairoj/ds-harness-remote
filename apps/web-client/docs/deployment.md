# 网页测试站点

2026-10-27，经用户确认启用。

- 入口：https://47.102.38.163:5555
- 账号：复用现有 cwj 账号和密码。
- 版本：a8c969ded873b53ab1edc66c444e3e062da44e76，原生界面基于 DSH 0.2.0-rc.2。
- 发布目录：/opt/dsh-remote-web/20261027-a8c969d；current 链接指向该目录。
- Nginx 配置：/etc/nginx/sites-available/dsh-remote-web-test。
- 现有 443 配置保留，未重启 DSH 或中继容器，仅 reload Nginx。
- 归档 SHA256：CCC3E16654FA8A711CBD741A569FEDE6A06FD8BB3CC27157C01675F24C02A8BB。

服务端归档校验、Nginx 配置检查、公网 HTTPS 5555 和原有 443 访问均通过。

公网入口 Playwright 验收通过（2 项，约 1.6 分钟）：账号登录与退出、新建测试会话的真实模型回复、停止生成、重新连接后打开该测试会话的历史、手机视口布局。未修改用户已有会话。真实 Safari 待用户验证。

回退时只停用 sites-enabled/dsh-remote-web-test，并在 nginx -t 通过后 reload Nginx；保留发布目录和中继数据。

## 缓存版本

2026-10-27 部署至同一 5555 入口。发布目录 `/opt/dsh-remote-web/20261027-cache-v3`，`previous` 链接保留上一发布目录。原有 443、DSH 和中继容器未重启。

归档 SHA256：D5D45B858A6D393B5BA8A6A2F9519E84DE64BD97B2CDF9EECEFC2E1A7C930006。

服务端归档校验、Nginx 配置检查、5555 与原有 443 的 HTTPS 访问通过。保留上一版的静态插件路径，供已经打开的旧页面完成延迟模块加载。

部署后公网验收通过：刷新后自动连接上次在线受信电脑、目录缓存先显示、优先恢复当前会话并预热最近会话（`MAX_RETAINED_SESSIONS = 8` 内存保活）后再更新后台完整目录、退出清理，以及版本化插件资源断网缓存读取。真实 Safari 仍待用户实机验证。

## GitHub 仓库与双端口发布流程（5556 预发 -> 5555 正式）

- 本地仓库目录：`D:\Workspace\ds-harness-remote`（其中 Web 客户端位于 `apps/web-client`）
- GitHub Fork 仓库：`https://github.com/nairoj/ds-harness-remote`（上游 `liguobao/ds-harness-remote`）
- 服务端 Git 克隆目录：`/opt/dsh-remote-web/repo`
- 预发布验证端口：`https://47.102.38.163:5556`（对应 `/opt/dsh-remote-web/staging/dist`）
- 正式服务端口：`https://47.102.38.163:5555`（对应 `/opt/dsh-remote-web/current/dist`）

### 标准更新步骤

1. 本地构建并提交到 GitHub：
   - 在 `D:\Workspace\ds-harness-remote\apps\web-client` 执行 `npx npm run build` 生成最新 `dist/`
   - 提交源码及 `apps/web-client/dist/` 并 `git push origin main`
2. 服务端拉取到 5556 预发环境（不影响 5555 在线用户）：
   - `sudo /opt/dsh-remote-web/repo/apps/web-client/deploy/release.sh stage`
   - 访问 `https://47.102.38.163:5556` 验证功能
3. 验证通过后原子切流到 5555 正式环境：
   - `sudo /opt/dsh-remote-web/repo/apps/web-client/deploy/release.sh promote`
   - 如需一键回滚上一正式版：`sudo /opt/dsh-remote-web/repo/apps/web-client/deploy/release.sh rollback`
