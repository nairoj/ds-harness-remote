# 测试入口部署方案

启用前先确认。此配置将 `https://47.102.38.163:5555` 用于新 Web 客户端；现有 443 中继站点保持原配置。

- 静态资源：生产构建的 `dist`，放在 `/opt/dsh-remote-web/<release>/dist`，`current` 指向该发布目录。
- Nginx：使用 `nginx-test.conf`，复用现有 IP 证书及续期任务。
- API 与 WebSocket：代理到现有 `127.0.0.1:8080`，保持中继服务的 Origin 配置。无需重启 DSH 或中继容器。
- 原来的账号密码直接可用；浏览器有独立设备身份，需要确认 Host 指纹。
- 回退：停用这一个 Nginx 测试站点并 reload。不会删除账号、设备或会话数据。

本地可先用 Vite preview 查看生产构建；测试使用的 API 代理配置同开发环境。
