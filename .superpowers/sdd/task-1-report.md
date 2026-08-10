# 任务 1：把已选提示词传入工作台

## 实现内容

- 将提示词库的 `onUsePrompt` 回调改为传递完整 `PromptCard`。
- 将 `AppShell` 的工作台视图状态改为保存完整卡片，并接入 `GenerationWorkspacePage`。
- 新增最小工作台外壳：返回按钮、工作台标题、卡片标题，以及只读提示词文本框。
- 删除原有 `WorkspacePlaceholder` 占位组件。

## 测试结果

执行命令：`cd frontend; npm test -- src/App.test.tsx`

- GREEN：通过，1 个测试文件、8 个测试全部通过。

## TDD RED/GREEN 证据

- RED：先将原占位断言替换为工作台标题、`测试卡片` 和 `测试提示词` 文本框断言。运行指定命令后，8 个测试中 1 个失败；失败信息为找不到 `测试卡片`，DOM 显示的仍是 `WorkspacePlaceholder` 与卡片 ID，符合功能尚未实现的预期。
- GREEN：完成最小卡片传递和工作台外壳后，重新运行相同命令；1 个测试文件通过，8 个测试全部通过。

## 变更文件

- `frontend/src/App.test.tsx`
- `frontend/src/components/AppShell.tsx`
- `frontend/src/components/PromptLibraryPage.tsx`
- `frontend/src/components/WorkspacePlaceholder.tsx`（删除）
- `frontend/src/components/GenerationWorkspacePage.tsx`（新增）

## 自审

- 卡片从提示词库以完整 `PromptCard` 传入工作台，未使用仅包含 ID 的中间状态。
- 工作台显示指定标题、所选卡片标题和只读提示词内容，并可返回提示词库。
- 未新增后端接口、上传、任务保存、生成结果、历史记录或其他后续交互。
- `git diff --check` 无空白错误；未改动或暂存无关的未跟踪文件。

## 问题与关注点

- 无。
