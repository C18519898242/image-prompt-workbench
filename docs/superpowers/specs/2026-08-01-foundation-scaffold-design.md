# Image Prompt Workbench 前后端脚手架设计

## 文档用途

本文档是 Image Prompt Workbench 第一阶段脚手架任务的设计和交付说明，供服务器上的 AI 按照本文档创建项目。

当前阶段只实现可运行的前后端基础链路：登录、内存 token 认证、欢迎接口、欢迎页面和退出登录。提示词卡片、生图 API、参考图上传等业务功能暂不实现。

## 已确认的架构

- 后端：Python FastAPI。
- 后端运行服务器：Uvicorn。
- 前端：React + Vite，建议使用 TypeScript。
- 数据库：SQLite，预留本地 `data/app.db`。
- 图片和其他本地文件：保存在 `data/` 目录。
- 开发环境：Vite 和 FastAPI 分开运行。
- 生产环境：服务器现有 Nginx 提供 React 静态文件，并把 `/api/` 反向代理到 FastAPI Docker 容器。
- 生产环境不在 FastAPI 容器中额外运行 Nginx。
- 前端和后端使用同一个域名，前端 API 地址统一使用相对路径 `/api`，生产环境不使用跨域请求。

生产请求关系如下：

```text
浏览器
  |
  v
服务器 Nginx
  |-- /       -> React dist 静态文件
  `-- /api/   -> FastAPI Docker 容器
                         |-- SQLite data/app.db
                         `-- 本地 data/ 目录
```

## 第一阶段目标

完成后应能做到：

1. 本地开发环境可以分别启动前端和后端。
2. Docker Compose 可以启动 FastAPI 后端。
3. 用户访问前端时看到登录页面。
4. 用户输入正确密码后，后端返回一个 token。
5. 前端只在 JavaScript 内存中保存 token。
6. 前端带 token 请求 `/api/welcome`。
7. 后端验证 token 后返回一行欢迎语。
8. 前端显示后端返回的欢迎语。
9. 用户点击退出后，后端删除当前 token，前端回到登录页面。
10. 第二次登录会让第一次登录的 token 立即失效。

## 认证规则

认证规则沿用 `2026-08-01-single-token-auth-design.md`：

- 不设置用户名。
- `.env` 中只保存一个共享密码的 Argon2id hash。
- 后端内存中只保存一个 `active_token`。
- 新登录成功后覆盖旧 token，旧 token 立即失效。
- token 不设置过期时间。
- token 不保存到 SQLite、文件、Redis、Cookie、`localStorage` 或 `sessionStorage`。
- 后端重启后 token 自然失效。
- 前端刷新页面后因内存状态丢失，需要重新登录。
- Docker 只运行一个 FastAPI worker 和一个应用副本。

推荐环境变量：

```env
AUTH_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'
```

`.env` 必须加入 `.gitignore`，仓库只提供不包含真实密码的 `.env.example`。

密码 hash 统一使用 `pwdlib[argon2]` 提供的 `PasswordHash.recommended()`。后端登录校验和命令行生成工具必须共用同一套 hash helper，不能各自实现算法或手动拼接 salt 和参数。

FastAPI 官方安全文档同样使用 `pwdlib[argon2]` 和 `PasswordHash.recommended()` 处理密码 hash：[FastAPI Password Hashing](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)、[pwdlib](https://pypi.org/project/pwdlib/)。

## Python 密码 hash 命令行工具

脚手架必须提供一个不启动 Web 服务即可运行的 Python 命令行工具，用于生成放入 `.env` 的密码 hash。

### 命令

在 `backend/` 目录下运行：

```bash
python -m app.cli hash-password
```

交互行为：

1. 第一次提示输入密码，使用隐藏输入。
2. 第二次提示确认密码，使用隐藏输入。
3. 两次输入一致且非空时，在标准输出打印 Argon2id hash。
4. 不接受 `--password` 等命令行明文密码参数，避免密码出现在 shell 历史和进程列表中。
5. 工具不自动修改 `.env`，用户手动将输出复制到 `AUTH_PASSWORD_HASH`。

示例：

```text
$ python -m app.cli hash-password
Password:
Confirm password:
$argon2id$v=19$m=65536,t=3,p=4$...
```

输出 hash 使用 PHC 字符串格式，包含算法标识、参数和随机 salt。`.env` 中复制时使用单引号包裹：

```env
AUTH_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'
```

命令行工具要求：

- 使用 `getpass.getpass()` 隐藏输入。
- 空密码、两次密码不一致、输入中断时不输出 hash，并以非零状态码退出。
- 成功退出码为 `0`。
- 参数错误或未知子命令退出码为 `2`。
- 错误信息写到 stderr，不把密码或 hash 写入日志。
- `python -m app.cli --help` 能显示命令说明。

认证模块提供可复用的纯函数接口：

```python
hash_password(plain_password: str) -> str
verify_password(plain_password: str, hashed_password: str) -> bool
```

Web 登录接口和 `app.cli` 必须调用这两个接口，避免生成和校验逻辑分叉。

## API 合同

### 健康检查

`GET /api/health`

不需要 token，返回：

```json
{
  "status": "ok"
}
```

### 登录

`POST /api/auth/login`

请求：

```json
{
  "password": "用户输入的密码"
}
```

成功返回 `200`：

```json
{
  "token": "随机生成的 token"
}
```

密码错误返回 `401`。响应不得泄露 hash、配置值或内部异常堆栈。

### 欢迎接口

`GET /api/welcome`

必须携带：

```http
Authorization: Bearer <token>
```

成功返回 `200`：

```json
{
  "message": "欢迎使用 Image Prompt Workbench"
}
```

缺少 token、token 不合法或 token 已被新登录替换时返回 `401`。

### 退出

`POST /api/auth/logout`

必须携带当前 token。只有 token 与当前 `active_token` 匹配时，后端才清空内存 token。成功返回 `204`。

旧客户端不能使用旧 token 注销新客户端的登录状态。

## 前端交互

前端只需要一个简单页面状态：

```text
没有 token -> 登录表单
有 token   -> 请求 /api/welcome -> 显示欢迎语和退出按钮
```

具体行为：

- 登录页面只有密码输入框和登录按钮。
- 登录成功后把 token 保存到 React 内存状态。
- API 请求封装自动添加 `Authorization` 请求头。
- 欢迎页面显示后端返回的 `message`，不要在前端硬编码欢迎正文。
- 点击退出时调用 `/api/auth/logout`，随后无论请求是否成功都清空前端 token。
- 任意业务 API 返回 `401` 时清空 token 并回到登录页面。
- 刷新浏览器后 token 消失，回到登录页面。

前端请求示例：

```ts
fetch("/api/welcome", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

## 目录边界

项目采用前后端分目录，职责保持清晰：

```text
image-prompt-workbench/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ config.py
│  │  ├─ auth.py
│  │  ├─ cli.py
│  │  └─ routes/
│  │     ├─ auth.py
│  │     └─ welcome.py
│  ├─ tests/
│  │  ├─ test_auth.py
│  │  ├─ test_cli.py
│  │  └─ test_welcome.py
│  ├─ requirements.txt
│  ├─ Dockerfile
│  └─ pyproject.toml
├─ frontend/
│  ├─ src/
│  │  ├─ App.tsx
│  │  ├─ api.ts
│  │  ├─ auth/
│  │  │  └─ AuthContext.tsx
│  │  └─ components/
│  │     ├─ LoginForm.tsx
│  │     ├─ WelcomeView.tsx
│  │     └─ LogoutButton.tsx
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vite.config.ts
│  └─ index.html
├─ data/
│  ├─ app.db
│  ├─ prompt-images/
│  ├─ reference-images/
│  └─ generated-images/
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
└─ README.md
```

边界要求：

- `backend/app/auth.py` 只负责内存 token 状态和密码校验，不负责 HTTP 路由。
- `backend/app/routes/auth.py` 只负责登录和退出接口。
- `backend/app/routes/welcome.py` 只负责受保护的欢迎接口。
- `backend/app/config.py` 只负责环境变量读取和启动配置校验。
- `frontend/src/api.ts` 只负责 HTTP 请求和认证请求头。
- `frontend/src/auth/AuthContext.tsx` 只负责前端内存 token 和登录状态。
- React 组件不直接拼接认证请求细节。
- 第一阶段不把提示词、生图、SQLite 业务表塞进登录模块。

## 本地开发方式

后端：

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

首次配置密码 hash：

```bash
cd backend
python -m app.cli hash-password
```

前端：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服务器将 `/api` 代理到 `http://127.0.0.1:8000`。前端代码始终使用相对路径 `/api/...`，不在组件中写死后端域名。

## Docker Compose

生产环境的 Compose 只运行 FastAPI 后端，Nginx 使用宿主机现有安装：

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "127.0.0.1:8000:8000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

FastAPI 使用单 worker 启动：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

React 发布流程：

```bash
cd frontend
npm run build
```

构建产生的 `frontend/dist/` 由宿主机 Nginx 提供，不需要复制到 FastAPI 镜像中。

## Nginx 配置要求

Nginx 使用同一个域名同时提供前端和后端 API。将下面配置中的域名和静态文件路径替换为服务器实际值：

```nginx
server {
    listen 443 ssl;
    server_name prompt.example.com;

    root /srv/image-prompt-workbench/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

要求：

- Nginx 负责 HTTPS，FastAPI 只监听宿主机本地端口。
- `/api/` 必须优先转发给 FastAPI，不能被 React 的 `index.html` fallback 捕获。
- React 路由刷新时由 `try_files ... /index.html` 处理。
- 生产环境不需要配置 CORS，因为前后端使用同一个域名和同源 `/api` 路径。
- 开发环境只使用 Vite proxy，不要为生产环境引入跨域配置。

## 测试与验收

后端自动测试至少覆盖：

1. `/api/health` 返回 `200`。
2. 正确密码登录返回 token。
3. 错误密码返回 `401`。
4. 无 token 请求 `/api/welcome` 返回 `401`。
5. 当前 token 请求 `/api/welcome` 返回欢迎语。
6. 第二次登录后第一个 token 失效。
7. 当前 token logout 后失效。
8. 旧 token 不能注销新 token。
9. 重新创建认证服务后旧 token 不再有效。
10. 命令行工具成功生成以 `$argon2id$` 开头的 hash。
11. 命令行工具拒绝空密码和不一致的确认密码。
12. 命令行工具不会把密码作为命令行参数或写入标准错误。

前端和部署验收至少包括：

1. `npm run build` 成功生成 `frontend/dist/`。
2. Vite 开发环境可以通过 `/api` 访问 FastAPI。
3. `docker compose up -d` 可以启动后端。
4. Nginx 可以打开 React 页面。
5. 同域名下 `/api/health` 可以被正常代理。
6. 登录、欢迎语显示、退出流程完整可用。
7. 刷新浏览器后需要重新登录。

## 本阶段明确不实现

- 提示词卡片和提示词 SQLite 表。
- Banana/Gemini 生图 API。
- 参考图上传。
- 分类、搜索和排序。
- 用户名、注册、多用户、角色权限。
- token 过期和持久化登录。
- FastAPI 容器内的 Nginx。
- 生产环境的第二个前端容器。

## 给执行 AI 的要求

请严格按本文档完成第一阶段脚手架，并保持变更范围最小：

1. 先创建目录和最小可运行应用。
2. 先实现后端测试，再实现对应的认证逻辑。
3. 使用 `pwdlib[argon2]` 和 `PasswordHash.recommended()` 实现密码 hash。
4. 将 `python -m app.cli hash-password` 作为独立可执行命令实现并测试。
5. 使用原生 `fetch`，不要为简单请求额外引入 HTTP 客户端依赖。
6. 不要把 token 写入任何持久化存储。
7. 不要把 API key、明文密码或密码 hash 打印到日志。
8. 不要实现本文档“本阶段明确不实现”的业务功能。
9. 更新 `README.md`，写清 hash 生成、本地开发、测试、Docker 和 Nginx 部署步骤。
10. 完成后运行后端测试、命令行工具测试、前端构建和 `git diff --check`，并报告实际结果。
