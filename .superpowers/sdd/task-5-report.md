# 任务 5：扩展前端 API 与中文错误详情

## RED

- 在 `frontend/src/api.test.ts` 新增提示词卡片创建、更新、删除和中文错误详情用例。
- 运行 `npm test -- src/api.test.ts`，4 个新增用例失败，原因是 `createPromptCard`、`updatePromptCard` 和 `deletePromptCard` 尚未导出。

## GREEN

- 在 `frontend/src/api.ts` 增加提示词图片清单联合类型、卡片变更请求类型和 CRUD API。
- 通过 `FormData` 提交图片清单与文件，仅传递鉴权头，不手动设置 `Content-Type`。
- `ApiError` 优先使用后端 JSON 响应中的非空字符串 `detail`，非 JSON 响应回退到稳定的中文状态码文案；204 响应不读取 JSON。
- 再次运行 `npm test -- src/api.test.ts`：5 个测试全部通过。

## 完整验证

- `npm test`：7 个测试文件、52 个测试全部通过。
- `npm run build`：TypeScript 编译和 Vite 生产构建成功。
- `git diff --check`：通过。
