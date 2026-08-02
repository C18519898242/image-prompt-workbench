# 生成历史数据 API 设计

## 1. 目标与范围

本次只为生成历史页提供后端数据 API，不实现历史页面，也不修改生成工作台页面。

图片生成成功后，每张生成图片保存一条历史记录。历史记录必须关联创建它的提示词卡片，供未来历史页按提示词卡片筛选。

本次实现范围：

- 新增历史记录
- 查询全部历史记录
- 按 `prompt_card_id` 查询历史记录
- 查询单条历史记录
- 删除历史记录及对应的本地生成图片

本次不实现：

- 历史页面或页面跳转
- 参考图保存
- 提示词快照保存
- 历史记录标题字段
- 批次、任务状态、失败记录和用户字段
- 搜索、分页、日期筛选、模型筛选或比例筛选
- “复制提示词”和“作为参考图”操作

## 2. 领域关系

一张提示词卡片可以产生多张历史图片，一张历史图片只属于一张提示词卡片：

```text
prompt_cards 1 ──── N generation_history
```

历史表只保存 `prompt_card_id`，不重复保存 `prompt_text`；本次历史页也不展示提示词。当前约定是生成通常使用提示词卡片的默认提示词，修改提示词时优先修改原卡片或创建新卡片。

## 3. 数据模型

新增表 `generation_history`：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY | 历史记录 ID |
| `prompt_card_id` | INTEGER | NOT NULL，外键 | 来源提示词卡片 ID |
| `image_path` | TEXT | NOT NULL | 相对 `data/` 的生成图片路径 |
| `model` | TEXT | NOT NULL | 实际使用的模型 |
| `aspect_ratio` | TEXT | NOT NULL | 实际使用的图片比例 |
| `resolution` | TEXT | NOT NULL | 实际使用的分辨率 |
| `created_at` | INTEGER | NOT NULL | Unix 时间戳，单位为秒，由服务端生成 |

外键指向 `prompt_cards(id)`。历史记录依赖提示词卡片存在；删除仍被历史记录引用的提示词卡片时，由外键约束阻止删除，避免历史记录失去来源。

为 `prompt_card_id` 建立查询索引。新数据库在 `backend/schema.sql` 中创建该表，已有数据库通过独立迁移文件创建该表。

生成图片统一保存于 `data/generated-images/`。API 不接收图片二进制，只接收生成服务已经保存好的相对路径；服务端校验路径必须位于生成图片目录内。

## 4. API 设计

所有接口都使用现有 Bearer Token 鉴权。

### 4.1 新增历史记录

```http
POST /api/generation-history
```

请求体：

```json
{
  "prompt_card_id": 12,
  "image_path": "generated-images/1754447075.png",
  "model": "Nano Banana 2",
  "aspect_ratio": "4:3",
  "resolution": "1K"
}
```

规则：

- 每调用一次新增一条记录；一次生成多张图片时分别调用或分别写入多条记录。
- `created_at` 不由客户端传入，由服务端生成。
- `prompt_card_id` 不存在时返回 `404`。
- 图片路径不合法或不在 `data/generated-images/` 内时拒绝保存。
- 成功返回 `201 Created` 和完整记录。

### 4.2 查询历史列表

```http
GET /api/generation-history
GET /api/generation-history?prompt_card_id=12
```

规则：

- 不传 `prompt_card_id` 时返回全部历史记录。
- 传入 `prompt_card_id` 时只返回该提示词卡片生成的记录。
- 默认按 `created_at DESC, id DESC` 排序，最新记录在前。
- 当前不增加其他筛选、搜索、分页和排序参数。

### 4.3 查询单条历史记录

```http
GET /api/generation-history/{history_id}
```

记录不存在时返回 `404`。

### 4.4 删除历史记录

```http
DELETE /api/generation-history/{history_id}
```

删除规则：

1. 根据记录中的 `image_path` 删除对应的本地生成图片。
2. 删除数据库中的历史记录。
3. 图片文件已经不存在时，仍删除数据库记录。

记录不存在时返回 `404`，成功返回 `204 No Content`。

## 5. 返回数据

历史记录响应包含数据库字段和两个计算字段：

```json
{
  "id": 1,
  "prompt_card_id": 12,
  "title": "江南烟雨 1754447075",
  "image_path": "generated-images/1754447075.png",
  "url": "/media/generated-images/1754447075.png",
  "model": "Nano Banana 2",
  "aspect_ratio": "4:3",
  "resolution": "1K",
  "created_at": 1754447075
}
```

- `title` 不保存到表中，由关联提示词卡片当前的 `prompt_cards.title + " " + created_at` 生成。
- 同一秒生成的多张图片允许得到相同标题，不额外增加唯一化字段或批次字段。
- `url` 不保存到表中，按现有 `/media/` 规则生成。
- 当前 API 不返回历史提示词文本，因为历史记录通过 `prompt_card_id` 关联提示词卡片。

## 6. 后端结构

- `backend/schema.sql`：新增 `generation_history` 表和索引。
- `backend/migrations/2026-08-02-add-generation-history.sql`：为已有数据库创建历史表和索引。
- `backend/app/generation_history_repository.py`：封装历史记录的新增、列表、详情和删除。
- `backend/app/routes/generation_history.py`：定义 Pydantic 请求/响应模型和四个鉴权路由。
- `backend/app/main.py`：注册历史路由。

实现沿用现有 SQLite 连接、Repository 和 `require_token` 鉴权模式，不引入新的 ORM、任务队列或存储服务。

## 7. 测试与验收

后端测试覆盖：

- 数据库创建历史表、外键和 `prompt_card_id` 索引。
- 未登录访问四个接口均返回 `401`。
- 新增成功后能保存正确的卡片关联、图片路径、模型、比例、分辨率和时间戳。
- 不存在的提示词卡片不能新增历史记录。
- 列表默认返回全部记录并按最新时间排序。
- `prompt_card_id` 筛选只返回对应卡片的历史图片。
- 详情能返回单条记录，不存在时返回 `404`。
- 删除会删除数据库记录和对应图片文件。
- 返回的 `title` 是计算字段，数据库中没有 `title` 列。
- 一次生成多张图片时，能保存为多条独立历史记录。

本次不添加前端页面测试，因为页面不在范围内。
