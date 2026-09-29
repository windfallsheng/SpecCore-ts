# Nginx 服务器部署指南（纯服务器，非 Docker）

> 本目录提供 **ssh 类型部署**场景下前端站点的 Nginx 服务器端配置模板。
> Docker 场景（Nginx 容器托管前端）请使用 `templates/deploy-docker/nginx.conf`。

---

## 两种 Nginx 场景怎么选

| 场景 | 部署类型 | 配置文件 | Nginx 位置 |
|:---|:---|:---|:---|
| **纯服务器**：构建产物上传到服务器 Nginx 静态目录，后端跑进程/systemd | `ssh`（推荐）/ `sftp` | 本目录 `nginx-site.conf` | 服务器 `/etc/nginx/conf.d/` |
| **容器化**：前端打成镜像由 Nginx 容器托管 | `docker` | `deploy-docker/nginx.conf` | 镜像内 `/etc/nginx/conf.d/` |

## 快速开始（前端 ssh 部署 + 服务器 Nginx 托管）

```bash
# 1. 服务器端（只需一次）：复制站点配置并替换占位符
sudo cp nginx-site.conf /etc/nginx/conf.d/admin-web.conf
sudo sed -i 's/{{DOMAIN}}/admin.example.com/; s|{{APP_DIR}}|/var/www/html/admin-web|; s|{{BACKEND_HOST}}|127.0.0.1:8080|' /etc/nginx/conf.d/admin-web.conf
sudo nginx -t && sudo nginx -s reload

# 2. PROJECT.yaml 配置 ssh 类型部署
#    remote_dir: /var/www/html/admin-web
#    script: sudo nginx -s reload

# 3. 部署（构建 → 上传 → 重载 Nginx）
speccore deploy --env staging --platform admin-web
```

## 模板包含内容

- SPA 路由回退（`try_files` → `/index.html`）
- gzip 压缩
- 静态资源长期缓存（`immutable`）
- `/api/` 反向代理到后端（同机 `127.0.0.1:8080` 或跨机内网地址）
- WebSocket 升级（注释备用）
- 健康检查端点透传（`/healthz` → 后端 `/actuator/health`，注释备用）
- HTTPS server 块（证书就绪后启用）
- 隐藏文件访问拦截

## 占位符

| 占位符 | 说明 | 示例 |
|:---|:---|:---|
| `{{DOMAIN}}` | 站点域名或 IP | `admin.example.com` |
| `{{APP_DIR}}` | 静态资源目录（= `remote_dir`） | `/var/www/html/admin-web` |
| `{{BACKEND_HOST}}` | 后端地址 | `127.0.0.1:8080` |

## 与冒烟测试联动

部署完成后可在 `.speccore/environments/{env}.yaml` 的 `tests.base_urls` 配置站点地址，
`speccore verify` 的部署后冒烟将自动访问验证：

```yaml
tests:
  base_urls:
    admin-web: https://admin.example.com
```
