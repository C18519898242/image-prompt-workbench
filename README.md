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
python -m uvicorn app.main:app --reload --port 8000
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

### 已有数据库迁移

全新数据库直接使用更新后的 `backend/schema.sql` 初始化即可，**不要**再执行迁移文件。

若数据库已在增加 `image_count` 字段之前创建，只需执行一次迁移：

```powershell
sqlite3 data/app.db < backend/migrations/2026-08-02-add-image-count.sql
```

使用 Python 时：

```powershell
python -c "import sqlite3; connection=sqlite3.connect('data/app.db'); connection.executescript(open('backend/migrations/2026-08-02-add-image-count.sql', encoding='utf-8').read()); connection.close()"
```

迁移会为已有卡片写入默认 `image_count = 1`。同一迁移不要重复执行。

## 导入提示词卡片

`app.import_prompt_cards` 用于从远程 `README_zh.md` 解析提示词卡片，下载示例图片，并写入 SQLite 数据库。运行前请先完成上面的数据表初始化。

在项目根目录执行：

```powershell
Set-Location C:\src\image-prompt-workbench\backend
python -m app.import_prompt_cards
```

不传参数时，命令使用默认来源，并将数据写入以下位置：

- 数据库：`C:\src\image-prompt-workbench\data\app.db`
- 图片目录：`C:\src\image-prompt-workbench\data\prompt-images`

也可以指定自己的远程 Markdown 地址、数据库和图片目录：

```powershell
python -m app.import_prompt_cards --source-url "https://github.com/用户/仓库/blob/main/README_zh.md" --database "C:\src\image-prompt-workbench\data\app.db" --image-dir "C:\src\image-prompt-workbench\data\prompt-images"
```

`--source-url` 支持 GitHub 的 `blob` 地址，程序会自动转换为原始文件地址。来源 Markdown 需要包含类似下面的卡片结构（标题可带 emoji，图片支持 Markdown 与 HTML `<img>`）：

````markdown
### No. 1: 卡片标题
#### 📝 提示词
```text
这里是提示词内容
```
#### 🖼️ 生成图片
<img src="https://example.com/example.png" alt="示例图片">
````

也兼容无 emoji 标题与 Markdown 图片写法（`#### 提示词` / `![示例](images/example.png)`）。

每张卡片都必须包含提示词和至少一张图片；缺少任一内容时，本次导入会失败。重复执行命令会重复插入卡片，当前不会自动去重。

### 多图命名与展示

一个卡片的图片按照 `0001-01.jpg`、`0001-02.jpg` 的顺序保存。
数据库使用第一张图片路径（`example_image_path`）和 `image_count` 记录多图关系。
列表页显示第一张图片和图片总数，点击后在详情轮播中完整查看图片（`object-fit: contain`，不裁剪、不拉伸）。
同一卡片 JPG/PNG 混用时当前只打印警告，不做格式转换。
重复导入策略暂不处理。

登录后，前端通过受 Bearer Token 保护的 `GET /api/prompt-cards` 拉取卡片元数据。  
接口中每张图返回：

- `path`：相对 `data/` 的路径，例如 `prompt-images/0001-01.jpg`
- `url`：同源公开地址，例如 `/media/prompt-images/0001-01.jpg`

浏览器用普通 `<img src={url}>` 加载图片，**不再**经 API 鉴权拉二进制，也**不需要** `blob:` URL。

开发时 Vite 将 `/media/*` 映射到仓库 `data/*`；生产由 Nginx 将 `/media/` alias 到服务器上的 `data/` 目录（见下文）。

## 静态图片与部署（域名指向前端根）

推荐形态：一个业务域名（例如 `image-prompt-workbench.xyz365.tech`）的 **站点根目录是前端构建产物**（`frontend/dist`），同一域名下再挂 API 与图片。

```text
https://image-prompt-workbench.xyz365.tech/
  /              → 前端 SPA（root = frontend/dist）
  /api/          → 反代本机 FastAPI（如 127.0.0.1:8000）
  /media/        → 静态映射到 data/（图片等）
```

### 本地开发（Vite）

`frontend/vite.config.ts` 已配置：

- `/api` → 代理到 `http://127.0.0.1:8000`
- `/media/...` → 读取仓库根目录 `data/...`

因此开发时图片地址为：

```text
http://localhost:5173/media/prompt-images/0001-01.jpg
```

对应磁盘文件：

```text
data/prompt-images/0001-01.jpg
```

请同时启动后端与 `npm run dev`，先完成数据表初始化与导入后再打开前端。

### 生产 Nginx（公用 Nginx + 独立域名）

示例配置见 [`deploy/nginx/image-prompt-workbench.conf.example`](deploy/nginx/image-prompt-workbench.conf.example)。要点：

1. `server_name` 设为业务域名；`root` 指向部署后的 `frontend/dist`。
2. `location /api/` 反代到后端进程（勿把 API 当静态文件找）。
3. `location /media/` 使用 `alias` 指向服务器上的 `data/` 目录（与导入图片目录一致）。
4. SPA 使用 `try_files $uri $uri/ /index.html`。

图片 URL 在生产环境同样是同源路径，例如：

```text
https://image-prompt-workbench.xyz365.tech/media/prompt-images/0001-01.jpg
```

说明：

- 卡片列表仍需登录；示例图 URL 本身为公开静态资源（知道完整 URL 即可访问）。若必须对图片也做鉴权，需改回 API 出图或 Cookie/签名方案。
- 公用 Nginx 上为每个站点使用独立 `server { server_name ... }` 即可，互不影响。

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
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Compose 只将容器绑定到 `127.0.0.1:8000:8000`，并挂载 `./data:/app/data`。`data/` 用于保存运行时状态，包括预留的 SQLite 文件和本地图片目录。不要提交运行时 SQLite 文件或生成的图片。

Nginx 由服务器现有环境负责，本仓库不配置或打包 Nginx。服务器 AI 的交接设计记录在 [`docs/superpowers/specs/2026-08-01-foundation-scaffold-design.md`](docs/superpowers/specs/2026-08-01-foundation-scaffold-design.md) 中：使用同一个域名，在 `/` 提供构建后的 `frontend/dist/`，并将 `/api/` 转发到后端容器。不要把 Nginx 加入 FastAPI 镜像，也不要把服务器配置当作本仓库维护的实现。

只支持一个 Uvicorn worker 和一个后端副本。认证使用一个保存在内存中的 bearer token，因此后端容器重启后，所有已有 token 都会失效。
