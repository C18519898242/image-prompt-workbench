# 提示词卡片数据库实现计划

**目标：** 使用 SQL 脚本创建提示词卡片数据库表，并用测试用例验证表结构已正确创建。

**范围：**

- 使用 `backend/schema.sql` 创建 SQLite 表。
- 使用测试用例读取并执行该 SQL 脚本。
- 测试三张表是否创建，以及关键字段、约束和索引是否存在。
- 在 README 中说明 SQL 脚本的执行方式。

**不包含：**

- 不编写 Python 数据库初始化模块。
- 不在应用启动时自动创建数据库。
- 不实现提示词卡片 CRUD API。
- 不增加作者、用户、收藏、点赞、评论或生成记录表。

## 数据库表

SQL 脚本：`backend/schema.sql`

包含以下三张表：

1. `prompt_cards`：保存提示词卡片。
2. `categories`：保存分类名称。
3. `prompt_card_categories`：保存卡片与分类的多对多关系。

卡片字段：

- `id`
- `title`
- `prompt_text`
- `example_image_path`
- `sort_order`
- `created_at`
- `updated_at`

分类字段：

- `id`
- `name`
- `sort_order`

关联表使用 `(prompt_card_id, category_id)` 作为联合主键，并对卡片和分类使用外键级联删除。

## 测试方案

测试文件：`backend/tests/test_database.py`

测试不依赖运行时的 `data/app.db`，而是在临时 SQLite 数据库中执行 `backend/schema.sql`，然后通过 SQLite 元数据检查结果。

测试内容：

1. SQL 脚本可以成功执行。
2. `prompt_cards`、`categories`、`prompt_card_categories` 三张表已创建。
3. `prompt_cards` 包含卡片所需字段。
4. `categories.name` 具有唯一约束。
5. 关联表具有联合主键和外键级联删除约束。
6. 分类查询所需索引已创建。

测试命令：

```powershell
cd backend
python -m pytest tests/test_database.py -q
```

## README 使用说明

README 需要说明：

- SQL 文件位置为 `backend/schema.sql`。
- 没有 `sqlite3` 命令行工具时，可以使用 Python 执行该 SQL 文件。
- 安装了 `sqlite3` 命令行工具时，可以直接使用 `sqlite3 data/app.db < backend/schema.sql`。

## 验收标准

- `backend/schema.sql` 可以独立创建三张表。
- 数据库测试通过。
- README 包含实际可执行的 SQL 使用命令。
- 不新增 Python 数据库初始化代码或其他业务功能。
