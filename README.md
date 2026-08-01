# Image Prompt Workbench

本仓库是 Image Prompt Workbench 的基础垂直切片，包含 FastAPI 后端和 React/Vite 前端，使用一个共享密码进行访问保护。

## 本地开发与启动

安装后端依赖并生成密码 hash：

```bash
# 1. 安装后端依赖
cd backend
python -m pip install -r requirements.txt

# 2. 生成 hash，并创建项目根目录下的 .env
python -m app.cli hash-password
```

将命令输出的 hash 写入项目根目录的 `.env` 文件：

```env
AUTH_PASSWORD_HASH='your-generated-argon2id-hash'
```

`AUTH_PASSWORD_HASH` 是唯一必需的应用密钥。请使用密码管理器或其他安全随机工具生成强度足够且唯一的密码，不要重复使用短密码。生成的 hash 包含 `$` 字符，使用单引号包裹可以避免 Docker Compose 对其进行插值。CLI 会隐藏密码输入、要求二次确认、不接受命令行明文密码参数，也不会自动写入 `.env`。

在第一个终端启动后端：

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

在第二个终端启动前端开发服务器：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服务器会把同源的 `/api` 请求代理到后端。打开 Vite 输出的前端地址，通常是：

```text
http://localhost:5173
```

后端健康检查地址：

```text
http://127.0.0.1:8000/api/health
```

前端登录时使用运行 `hash-password` 时输入的原始密码。明文密码不会写入 `.env`。

## 创建 SQLite 数据表

建表 SQL 保存在 [`backend/schema.sql`](backend/schema.sql)，包含提示词卡片、分类，以及卡片与分类的多对多关联表。

由于部分 Windows 环境没有安装 `sqlite3` 命令行工具，可以使用 Python 执行这份 SQL：

```powershell
python -c "import sqlite3; connection=sqlite3.connect('data/app.db'); connection.executescript(open('backend/schema.sql', encoding='utf-8').read()); connection.close()"
```

如果已安装 `sqlite3` 命令行工具，也可以直接执行：

```powershell
sqlite3 data/app.db < backend/schema.sql
```

## 测试与构建

```bash
# 3. 测试后端
cd backend
python -m pytest -q

# 4. 构建前端
cd ../frontend
npm install
npm test -- --run
npm run build
```

构建输出目录是 `frontend/dist/`，该目录不会提交到 Git。

## Docker Compose 与服务器 Nginx 交接

在服务器环境中构建前端，按上文创建被忽略的根目录 `.env`，然后在项目根目录启动后端容器：

```bash
# 5. 在项目根目录启动后端容器
docker compose up -d --build
```

后端容器的启动命令：

```text
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Compose 只将容器绑定到 `127.0.0.1:8000:8000`，并挂载 `./data:/app/data`。`data/` 用于保存运行时状态，包括预留的 SQLite 文件和本地图片目录。不要提交运行时 SQLite 文件或生成的图片。

Nginx 由服务器现有环境负责，本仓库不配置或打包 Nginx。服务器 AI 的交接设计记录在 [`docs/superpowers/specs/2026-08-01-foundation-scaffold-design.md`](docs/superpowers/specs/2026-08-01-foundation-scaffold-design.md) 中：使用同一个域名，在 `/` 提供构建后的 `frontend/dist/`，并将 `/api/` 转发到后端容器。不要把 Nginx 加入 FastAPI 镜像，也不要把服务器配置当作本仓库维护的实现。

只支持一个 Uvicorn worker 和一个后端副本。认证使用一个保存在内存中的 bearer token，因此后端容器重启后，所有已有 token 都会失效。
