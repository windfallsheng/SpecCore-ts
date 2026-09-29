# 通用部署脚本模板

> 本目录提供 `script` 类型部署的**开箱即用脚本实体**，覆盖 Jenkins 触发、FTP 上传、密码 SSH、Compose 编排、Python 服务五类场景。
> 对应 `templates/deploy-examples.yaml` 中 script 类型各节的注释示例。

---

## 脚本清单

| 脚本 | 场景 | 依赖 | 关键环境变量 |
|:---|:---|:---|:---|
| `trigger-jenkins.sh <job>` | 触发 Jenkins 构建发布 | `curl` | `JENKINS_URL` `JENKINS_USER` `JENKINS_TOKEN` |
| `deploy-ftp.sh [dir]` | 虚拟主机 FTP 上传（无 SSH 权限） | `lftp` | `FTP_USER` `FTP_PASS` `FTP_HOST` `FTP_REMOTE_DIR` |
| `deploy-password-ssh.sh [dir]` | 密码认证 SSH 部署（无密钥） | `sshpass` | `SSH_USER` `SSH_PASSWORD` `SSH_HOST` `SSH_REMOTE_DIR` |
| `deploy-compose.sh [file]` | 服务器端 Compose 编排部署 | `docker-compose` | — |
| `deploy-python.sh [dir]` | Python gunicorn + systemd 部署 | `rsync` | `DEPLOY_HOST` `DEPLOY_DIR` `SERVICE_NAME` |

## 目录组织约定

部署脚本按「执行位置」分三处存放，各司其职：

```
① 包内模板 templates/deploy-*/
   ├── deploy-scripts/        ← 通用脚本实体（本目录，script 类型直接引用）
   ├── deploy-docker/         ← Docker 构建素材 + 服务器端容器管理脚本（deploy-remote.sh）
   ├── deploy-java/           ← Java systemd/Docker 素材 + 服务器端脚本（deploy.sh）
   └── deploy-nginx/          ← 纯服务器 Nginx 站点配置
         ↓（npm 安装后用户手动 cp 到工程）

② 用户项目 .speccore/environments/scripts/（init 自动生成）
   ├── deploy.sh              ← 通用 script 类型骨架（TODO 待填）
   ├── ecosystem.config.js    ← pm2 类型
   ├── k8s-deployment.yaml    ← k8s 类型
   ├── java-systemd.service / java-restart.sh ← ssh 类型 Java
   └── values-{env}.yaml      ← helm 类型（按环境生成）
         ↓（speccore deploy 按 script/pm2_config/output_dir 字段引用）

③ 端工程内 scripts/（用户自维护）
   ← 端专属脚本，config.script 用 ./scripts/xxx.sh 相对路径引用
```

> **路径解析（v8.3.296+）**：引擎对 `script` / `pm2_config` / k8s manifest / helm values 做双基准解析——先在端目录（code_path）找，回退项目根。`./scripts/xxx.sh` 与 `.speccore/environments/scripts/xxx` 两种写法都通。

## 使用方式

```yaml
# PROJECT.yaml（script 类型）
deploy:
  staging:
    type: script
    build_cmd: npm run build
    script: ./scripts/deploy-password-ssh.sh   # 端工程内脚本（推荐）
    # 或引用项目根资产：
    # script: .speccore/environments/scripts/deploy.sh
```

敏感信息（密码/token）一律通过环境变量注入，勿写入配置文件或 git：

```bash
SSH_USER=deployer SSH_PASSWORD=xxx SSH_HOST=server ./scripts/deploy-password-ssh.sh dist
```
