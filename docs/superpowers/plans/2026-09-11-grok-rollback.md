# Grok 图片生成功能回滚实施计划

> **供智能执行者使用：** 必须逐项执行本计划并在每个检查点核对结果；本计划不使用子代理。

**目标：** 通过一个新的反向提交完整撤销七个 Grok 相关提交，使项目恢复为只支持 Nano Banana 2 / Gemini 图片生成的状态。

**架构：** 使用 `git revert --no-commit` 反向应用 `7c050b4` 至 `272091c` 的连续变更，不改写分支历史。反向变更只删除 Grok 设计、配置、客户端、路由分派、界面选项、测试和说明，同时恢复 Grok 引入前的 Gemini 类型定义与调用路径。

**技术栈：** Git、Python 3、FastAPI、pytest、TypeScript、React、Vitest、Vite。

## 全局约束

- 所有新增文档必须使用中文编写。
- 不使用子代理。
- 不执行 `git reset --hard`、强制推送或文件清理。
- 不暂存、不修改 `.idea/`、日志、测试临时目录、输出图片等未跟踪文件。
- 回滚范围固定为 `c151e04..272091c`，不得包含之后新增的回滚设计与实施计划。
- 最终只创建一个 Grok 功能回滚提交。

---

### 任务 1：完整撤销 Grok 图片生成功能

**文件：**

- 删除：`backend/app/grok_image_generator.py`
- 删除：`backend/app/image_generation_types.py`
- 删除：`backend/tests/test_grok_image_generator.py`
- 删除：`docs/superpowers/specs/2026-09-07-grok-image-generation-design.md`
- 删除：`docs/superpowers/plans/2026-09-07-grok-image-generation.md`
- 修改：`README.md`
- 修改：`backend/app/config.py`
- 修改：`backend/app/gemini_image_generator.py`
- 修改：`backend/app/main.py`
- 修改：`backend/app/routes/generations.py`
- 修改：`backend/tests/test_config.py`
- 修改：`backend/tests/test_gemini_image_generator.py`
- 修改：`backend/tests/test_generation_routes.py`
- 修改：`frontend/src/components/GenerationWorkspacePage.tsx`
- 修改：`frontend/src/components/GenerationWorkspacePage.test.tsx`
- 修改：`frontend/src/generation.ts`
- 修改：`frontend/src/index.css`

**接口：**

- 保留：`POST /api/generations` 的 Nano Banana 2 / Gemini 生图能力。
- 删除：`GenerationModel` 中的 `"Grok Imagine"` 选项。
- 删除：后端 `GROK_API_KEY`、`GROK_BASE_URL`、`GROK_MODEL` 配置与 Grok 请求分派。
- 恢复：Gemini 专用的 `GeminiImageError`、`ReferenceImage`、`GeneratedImage` 类型定义和原有调用方式。

- [ ] **步骤 1：记录回滚前的受控状态**

运行：

```powershell
git status --short
git log -10 --oneline
```

预期：`79fcba9` 和本实施计划提交位于七个 Grok 提交之后；未跟踪项可能存在，但没有已跟踪文件的未提交修改。

- [ ] **步骤 2：反向应用七个 Grok 提交但暂不提交**

运行：

```powershell
git revert --no-commit c151e04..272091c
```

预期：命令成功且没有冲突；当前索引中包含七个 Grok 提交的反向差异，`79fcba9` 及本计划不在回滚范围内。

- [ ] **步骤 3：核对回滚差异与文件边界**

运行：

```powershell
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached -- frontend/src/components/GenerationWorkspacePage.tsx backend/app/routes/generations.py backend/app/config.py README.md
```

预期：只有“文件”小节列出的 17 个 Grok 相关路径发生删除或修改；`git diff --cached --check` 无输出；未跟踪文件没有进入索引。

- [ ] **步骤 4：验证代码与文档中不再残留 Grok 运行能力**

运行：

```powershell
rg -n -i "grok" README.md backend frontend -g '!node_modules' -g '!dist'
```

预期：命令不返回匹配项。回滚设计和实施计划属于审计记录，因此不在搜索范围内。

- [ ] **步骤 5：运行后端完整测试**

运行：

```powershell
Set-Location backend
python -m pytest -q
Set-Location ..
```

预期：所有后端测试通过，没有失败或错误。

- [ ] **步骤 6：运行前端完整测试**

运行：

```powershell
Set-Location frontend
npm test -- --run
Set-Location ..
```

预期：所有前端测试通过，没有失败或未处理错误。

- [ ] **步骤 7：构建前端生产包**

运行：

```powershell
Set-Location frontend
npm run build
Set-Location ..
```

预期：TypeScript 检查和 Vite 构建成功，生成 `frontend/dist/`，没有构建错误。

- [ ] **步骤 8：提交已验证的回滚**

运行：

```powershell
git commit -m "revert: 移除 Grok 图片生成功能"
```

预期：创建一个新提交；该提交只包含步骤 2 已进入索引的 Grok 反向变更，不包含未跟踪文件。

- [ ] **步骤 9：核对最终提交和工作区**

运行：

```powershell
git show --stat --oneline HEAD
git status --short
```

预期：`HEAD` 为 `revert: 移除 Grok 图片生成功能`；工作区可能仍列出原有未跟踪文件，但没有已跟踪文件的未提交修改。
