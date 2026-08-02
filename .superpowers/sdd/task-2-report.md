# 任务 2 报告：生成工作台本地交互

## 实现内容

- 提示词以卡片的 `prompt_text` 初始化，并且只维护当前页面内的可编辑状态。
- 示例图默认显示第一张，支持在有效范围内前后切换；无图时显示空状态。示例图容器保留 4:3 与 `contain` 对应的结构类名。
- 参考图使用隐藏的原生文件选择器和 `URL.createObjectURL` 进行本地预览。删除、替换以及组件卸载时都会释放相应的对象 URL。
- 高级参数可展开或收起，展开后仅提供模型、比例、分辨率、生成数量和思考级别五个下拉选择。
- 页面仅保留一个“开始生成”按钮。空白提示词不可提交；有效提交后显示本地演示反馈，不调用接口、不跳转、不展示结果或历史。

## RED 测试结果

在 `frontend` 目录运行：

```powershell
npm test -- src/components/GenerationWorkspacePage.test.tsx
```

结果：退出码 1，5 个测试全部失败。失败原因均为原占位页面缺少示例图、参考图、本地提交和高级参数交互，符合预期 RED 状态。

## GREEN 测试结果

在 `frontend` 目录运行：

```powershell
npm test -- src/components/GenerationWorkspacePage.test.tsx
```

结果：退出码 0，1 个测试文件通过，5 个测试全部通过。

## 差异检查

在仓库根目录运行：

```powershell
git diff --check
```

结果：退出码 0，无空白错误。

## 自审

- 未修改 AppShell、提示词库、App 测试、CSS、API、后端或其他功能文件。
- 未实现清空、字符数统计、自定义快捷键、拖拽、裁剪、上传进度、结果图、历史、后端调用、随机种子或其他未确认高级参数。
- 参考图对象 URL 在删除、替换和卸载路径均会释放；页面只保存本地状态。
- 工作区原有的未提交文件未纳入本任务提交。

## 变更文件

- `frontend/src/components/GenerationWorkspacePage.tsx`
- `frontend/src/components/GenerationWorkspacePage.test.tsx`
- `.superpowers/sdd/task-2-report.md`

## 修复补充：收敛生成工作台交互

### 修复内容

- 示例图容器新增内联 `aspectRatio: "4 / 3"`，图片新增内联 `objectFit: "contain"`，并在行为测试中验证这两个约束；保留“仅用于理解效果”说明。
- 参考图标题改为“生成参考图（可选）”。隐藏的原生文件选择器启用 `multiple`，本地预览改为两列网格，并支持逐张删除。
- 参考图对象 URL 在逐张删除、下一次选择替换和组件卸载时都会调用 `URL.revokeObjectURL` 释放。
- 参数值收敛为已确认设计：模型 Nano Banana 2；比例默认 4:3；分辨率默认 1K；生成数量默认 1；思考级别默认中等，且只保留其确认的选项。

### TDD 与测试结果

先更新工作台测试后，在 `frontend` 目录运行：

```powershell
npm test -- src/components/GenerationWorkspacePage.test.tsx
```

RED 结果：退出码 1，新增断言在参考图标题、示例图 4:3/contain、`multiple` 多图选择与参数默认值上失败，确认覆盖原审查缺口。

实现后再次运行相同命令：退出码 0，1 个测试文件通过，5 个测试全部通过。

全量验证：

```powershell
npm test
git diff --check
```

结果：前端 5 个测试文件、27 个测试全部通过；差异检查退出码 0，无空白错误。

### 修复自审

- 仅修改生成工作台组件、其测试和本任务报告；未改 CSS、AppShell、API 或后端。
- 未增加后端调用、结果、历史、清空、字符数、快捷键、拖拽、裁剪、上传进度或随机种子。
- 页面仍只有一个“开始生成”按钮，提示词与参考图均只使用当前页面本地状态。
