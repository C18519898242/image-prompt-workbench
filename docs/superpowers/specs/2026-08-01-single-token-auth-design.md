# 单用户内存 Token 登录设计

## 目标

为 Image Prompt Workbench 增加一个面向个人使用的最简登录机制：用户只输入共享密码，不设置用户名；密码 hash 从项目根目录的 `.env` 读取；登录成功后获得一个仅保存在内存中的 token，用于访问后端 API。

该方案不引入用户系统、数据库会话、持久化 token 或 token 过期机制。

## 已确认范围

- 只有一个共享密码，没有用户名。
- `.env` 只保存密码 hash，不保存明文密码。
- 后端运行期间最多存在一个有效 token。
- 新登录成功后立即覆盖旧 token，旧登录被踢出。
- 提供 `logout` 接口，注销时删除当前内存 token。
- token 不设置过期时间。
- 服务重启后内存清空，所有 token 失效。
- 浏览器端只在 JavaScript 内存中保存 token，不写入 `localStorage`、`sessionStorage`、Cookie 或 SQLite。
- 该功能面向个人项目，不处理多用户、权限角色和账号管理。

## 架构

FastAPI 后端新增一个进程内认证服务。认证服务在启动时读取 `AUTH_PASSWORD_HASH`，登录时使用 Argon2id 校验密码；校验成功后使用密码学安全随机数生成 token，并替换当前的 `active_token`。

前端在 React 状态中保存 token。所有需要认证的 API 请求通过 `Authorization: Bearer <token>` 发送 token。后端使用统一的认证依赖检查请求 token 是否与当前 `active_token` 完全一致。

SQLite 和本地图片目录不参与登录状态保存，Docker 只需要持久化 `data/` 目录。

## 配置

`.env` 使用以下配置项：

```env
AUTH_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'
```

密码 hash 使用 Argon2id 生成和校验，后端使用支持 Argon2id 的密码哈希库，不自行实现哈希算法。`.env` 必须加入 `.gitignore`；仓库只提供不含真实密码的 `.env.example`。

由于 Argon2id 字符串包含 `$`，`.env` 中的值使用单引号包裹，避免 Docker Compose 或其他环境加载配置时发生变量插值问题。

## API 设计

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
  "token": "随机生成的 opaque token"
}
```

密码错误返回 `401`，响应不区分“密码错误”和其他认证失败原因，避免泄露配置细节。

每次成功登录都会生成新 token，并原子替换旧 token。旧 token 立即失效。

### 注销

`POST /api/auth/logout`

请求必须携带当前 token。只有请求 token 与 `active_token` 相同时才清空 token，避免旧客户端误注销新客户端。成功返回 `204`。

### 认证保护

除以下公开接口外，所有后端业务 API 都必须通过认证依赖：

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout` 允许携带 token 调用

缺少 token、token 格式错误或 token 已被新登录替换时返回 `401`。

## 内存状态接口

认证服务只维护一个状态字段：

```python
active_token: str | None
```

对外提供以下行为：

- `login(password) -> token`：校验密码，生成并保存新 token。
- `authenticate(token) -> bool`：判断 token 是否为当前有效 token。
- `logout(token) -> None`：仅当 token 匹配时清空当前 token。

替换和清空 token 的操作需要使用进程内锁保护，避免并发登录或注销造成状态竞争。

## 前端行为

- 没有内存 token 时显示登录页面，不展示需要认证的业务内容。
- 登录成功后把 token 写入 React 内存状态，并跳转到主界面。
- API 请求统一由请求封装自动添加 `Authorization` 请求头。
- 任意业务 API 返回 `401` 时清空前端 token，回到登录页面。
- 点击退出时调用 logout；即使请求失败，前端也清空本地内存 token。
- 页面刷新会丢失 token，需要重新登录，这是“只保存在内存中”的预期行为。

## Docker 部署约束

由于 token 保存在单个 Python 进程内：

- FastAPI 使用单 worker 启动。
- Compose 只运行一个应用副本。
- 暂不支持多副本、负载均衡或横向扩展。
- 应用重启后所有登录状态自然失效。

示例启动方式应保持单 worker：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

## 错误处理

- `.env` 缺少 `AUTH_PASSWORD_HASH` 时，应用启动失败并明确提示配置缺失。
- 密码 hash 格式非法时，应用启动失败，不允许以未保护状态启动。
- 登录失败统一返回 `401`，不返回 hash、配置值或内部异常堆栈。
- 业务 API 未认证统一返回 `401`。
- 后端重启不恢复旧 token。

## 测试要求

后端至少覆盖以下场景：

1. 正确密码登录返回 token。
2. 错误密码返回 `401`。
3. 缺少 token 访问受保护 API 返回 `401`。
4. 当前 token 访问受保护 API 成功。
5. 第二次登录后，第一个 token 访问受保护 API 返回 `401`。
6. 当前 token logout 后失效。
7. 旧 token 不能注销新登录产生的 token。
8. 服务重新创建认证服务后，之前的 token 不再有效。

前端验收至少包括：登录成功进入主界面、刷新页面回到登录页、401 自动回到登录页、退出后无法继续访问业务 API。

## 非目标

当前版本不实现：

- 用户名、注册、修改密码和找回密码。
- 多账号、多角色和权限管理。
- token 过期、刷新 token 或“记住我”。
- 数据库会话、Redis 会话或持久化登录。
- 多 worker、多副本和分布式认证。
- 公网产品级安全能力。
