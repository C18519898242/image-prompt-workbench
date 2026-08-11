import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { PromptCard } from "../api";
import { AuthProvider } from "../auth/AuthContext";
import { PromptCardEditorDrawer } from "./PromptCardEditorDrawer";

const savedCard: PromptCard = {
  id: 3,
  title: "新标题",
  prompt_text: "新提示词",
  sort_order: 0,
  category_ids: [],
  categories: [],
  image_count: 1,
  example_image_path: "prompt-images/new-01.jpg",
  images: [
    {
      index: 1,
      path: "prompt-images/new-01.jpg",
      url: "/media/prompt-images/new-01.jpg",
    },
  ],
};

const editableCard: PromptCard = {
  ...savedCard,
  id: 2,
  title: "旧标题",
  prompt_text: "旧提示词",
  image_count: 2,
  example_image_path: "prompt-images/old-01.jpg",
  images: [
    {
      index: 1,
      path: "prompt-images/old-01.jpg",
      url: "/media/prompt-images/old-01.jpg",
    },
    {
      index: 2,
      path: "prompt-images/old-02.jpg",
      url: "/media/prompt-images/old-02.jpg",
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(savedCard), { status: 201 }),
    ),
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    (value) => `blob:${(value as File).name}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

function renderDrawer(options: {
  mode: "create" | "edit";
  card: PromptCard | null;
  onSaved?: (card: PromptCard) => void;
  onClose?: () => void;
}) {
  const onSaved = options.onSaved ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  const view = render(
    <AuthProvider>
      <PromptCardEditorDrawer
        token="token"
        mode={options.mode}
        card={options.card}
        onSaved={onSaved}
        onClose={onClose}
      />
    </AuthProvider>,
  );
  return { ...view, onSaved, onClose };
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("标题"), "新标题");
  await user.type(screen.getByLabelText("提示词正文"), "新提示词");
  await user.upload(
    screen.getByLabelText("上传示例图"),
    new File(["image"], "one.jpg", { type: "image/jpeg" }),
  );
}

test("新增抽屉要求标题、提示词和至少一张图片", async () => {
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });

  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  expect(screen.getByText("请输入标题")).toBeInTheDocument();
  expect(screen.getByText("请输入提示词")).toBeInTheDocument();
  expect(screen.getByText("请至少上传一张示例图")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("新增保存成功提交表单、清理预览并回传卡片", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  renderDrawer({ mode: "create", card: null, onSaved });
  await fillCreateForm(user);

  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedCard));
  expect(fetch).toHaveBeenCalledWith(
    "/api/prompt-cards",
    expect.objectContaining({ method: "POST" }),
  );
  const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
  expect(body.get("title")).toBe("新标题");
  expect(body.get("prompt_text")).toBe("新提示词");
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([
    { kind: "upload", file_index: 0 },
  ]);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one.jpg");
});

test("编辑模式回填并通过 PUT 提交现有图片顺序", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(savedCard), { status: 200 }),
    ),
  );
  renderDrawer({ mode: "edit", card: editableCard, onSaved });

  expect(screen.getByRole("dialog", { name: "编辑提示词" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  expect(screen.getByLabelText("标题")).toHaveValue("旧标题");
  expect(screen.getByLabelText("提示词正文")).toHaveValue("旧提示词");
  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedCard));
  expect(fetch).toHaveBeenCalledWith(
    "/api/prompt-cards/2",
    expect.objectContaining({ method: "PUT" }),
  );
  const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([
    { kind: "existing", image_index: 1 },
    { kind: "existing", image_index: 2 },
  ]);
});

test("打开抽屉后聚焦标题输入框", () => {
  renderDrawer({ mode: "create", card: null });

  expect(screen.getByRole("dialog", { name: "新增提示词" })).toBeInTheDocument();
  expect(screen.getByLabelText("标题")).toHaveFocus();
});

test("多选图片按选择顺序追加", async () => {
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });
  const first = new File(["first"], "first.png", { type: "image/png" });
  const second = new File(["second"], "second.jpg", { type: "image/jpeg" });

  await user.upload(screen.getByLabelText("上传示例图"), [first, second]);

  const names = screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".prompt-editor-image-name")?.textContent);
  expect(names).toEqual(["first.png", "second.jpg"]);
  expect(URL.createObjectURL).toHaveBeenNthCalledWith(1, first);
  expect(URL.createObjectURL).toHaveBeenNthCalledWith(2, second);
});

test("非法文件显示校验错误并清空文件输入", async () => {
  const user = userEvent.setup({ applyAccept: false });
  renderDrawer({ mode: "create", card: null });
  const input = screen.getByLabelText("上传示例图");

  await user.upload(
    input,
    new File(["gif"], "bad.gif", { type: "image/gif" }),
  );

  expect(screen.getByText("仅支持 JPG 和 PNG 图片")).toBeInTheDocument();
  expect(input).toHaveValue("");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test("移除上传图片只撤销对应 blob 且卸载不重复撤销", async () => {
  const user = userEvent.setup();
  const { unmount } = renderDrawer({ mode: "edit", card: editableCard });
  await user.upload(
    screen.getByLabelText("上传示例图"),
    new File(["upload"], "upload.png", { type: "image/png" }),
  );

  await user.click(screen.getByRole("button", { name: "图片 3 移除" }));
  expect(screen.queryByText("upload.png")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:upload.png");

  await user.click(screen.getByRole("button", { name: "图片 1 移除" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test("卸载时每个仍在队列中的上传预览恰好撤销一次", async () => {
  const user = userEvent.setup();
  const { unmount } = renderDrawer({ mode: "create", card: null });
  await user.upload(screen.getByLabelText("上传示例图"), [
    new File(["a"], "a.png", { type: "image/png" }),
    new File(["b"], "b.jpg", { type: "image/jpeg" }),
  ]);

  unmount();

  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.png");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b.jpg");
});

test("按钮排序改变提交清单且保存期间防重复提交和关闭", async () => {
  let resolveResponse!: (response: Response) => void;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const confirm = vi.spyOn(window, "confirm");
  const user = userEvent.setup();
  const { onClose } = renderDrawer({ mode: "edit", card: editableCard });
  await user.click(screen.getByRole("button", { name: "图片 2 前移" }));
  expect(screen.getByRole("button", { name: "图片 1 前移" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "图片 2 后移" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "保存提示词" }));
  const savingButton = screen.getByRole("button", { name: "保存中…" });
  expect(savingButton).toBeDisabled();
  await user.click(savingButton);
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByTestId("prompt-editor-backdrop"));
  fireEvent.keyDown(window, { key: "Escape" });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([
    { kind: "existing", image_index: 2 },
    { kind: "existing", image_index: 1 },
  ]);
  resolveResponse(new Response(JSON.stringify(savedCard), { status: 200 }));
});

test("拖动排序改变提交图片清单", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(savedCard), { status: 200 }),
    ),
  );
  renderDrawer({ mode: "edit", card: editableCard });
  const firstItem = screen.getByText("old-01.jpg").closest("li");
  const secondItem = screen.getByText("old-02.jpg").closest("li");
  expect(firstItem).not.toBeNull();
  expect(secondItem).not.toBeNull();

  fireEvent.dragStart(firstItem!);
  fireEvent.dragOver(secondItem!);
  fireEvent.drop(secondItem!);
  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("image_manifest")))).toEqual([
    { kind: "existing", image_index: 2 },
    { kind: "existing", image_index: 1 },
  ]);
});

test.each([
  ["取消按钮", (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "取消" }))],
  ["关闭按钮", (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "关闭" }))],
  ["遮罩", async () => fireEvent.click(screen.getByTestId("prompt-editor-backdrop"))],
  ["Escape", async () => fireEvent.keyDown(window, { key: "Escape" })],
])("有未保存修改时%s走统一关闭确认", async (_name, close) => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  const { onClose } = renderDrawer({ mode: "edit", card: editableCard });
  await user.type(screen.getByLabelText("标题"), "修改");

  await close(user);
  expect(confirm).toHaveBeenCalledWith("当前修改尚未保存，确定关闭吗？");
  expect(onClose).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await close(user);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("无修改时关闭不弹出确认", async () => {
  const confirm = vi.spyOn(window, "confirm");
  const user = userEvent.setup();
  const { onClose } = renderDrawer({ mode: "edit", card: editableCard });

  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(confirm).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("保存失败后保留文字和图片", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "保存提示词失败" }), {
        status: 500,
      }),
    ),
  );
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });
  await user.type(screen.getByLabelText("标题"), "保留标题");
  await user.type(screen.getByLabelText("提示词正文"), "保留提示词");
  await user.upload(
    screen.getByLabelText("上传示例图"),
    new File(["image"], "one.jpg", { type: "image/jpeg" }),
  );

  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("保存提示词失败");
  expect(screen.getByLabelText("标题")).toHaveValue("保留标题");
  expect(screen.getByLabelText("提示词正文")).toHaveValue("保留提示词");
  expect(screen.getByText("one.jpg")).toBeInTheDocument();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

test("未知保存错误显示稳定文案", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  const user = userEvent.setup();
  renderDrawer({ mode: "create", card: null });
  await fillCreateForm(user);

  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "保存提示词失败，请稍后重试",
  );
});

test("401 保存错误清除当前认证 token", async () => {
  sessionStorage.setItem("ipw.auth.token", "token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "登录已过期" }), { status: 401 }),
    ),
  );
  const user = userEvent.setup();
  renderDrawer({ mode: "edit", card: editableCard });

  await user.click(screen.getByRole("button", { name: "保存提示词" }));

  await waitFor(() => {
    expect(sessionStorage.getItem("ipw.auth.token")).toBeNull();
  });
  expect(screen.getByRole("alert")).toHaveTextContent("登录已过期");
});
