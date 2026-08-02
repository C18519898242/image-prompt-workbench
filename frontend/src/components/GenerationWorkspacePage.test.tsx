import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { GenerationWorkspacePage } from "./GenerationWorkspacePage";

const card = {
  id: 1,
  title: "江南烟雨",
  prompt_text: "水墨山水长卷",
  sort_order: 1,
  category_ids: [],
  categories: [],
  image_count: 2,
  example_image_path: "prompt-images/0001-01.jpg",
  images: [
    {
      index: 1,
      path: "prompt-images/0001-01.jpg",
      url: "/media/prompt-images/0001-01.jpg",
    },
    {
      index: 2,
      path: "prompt-images/0001-02.jpg",
      url: "/media/prompt-images/0001-02.jpg",
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWorkspace() {
  return render(<GenerationWorkspacePage card={card} onBack={vi.fn()} />);
}

test("显示生成工作台的必要区域，且没有清空或字符数功能", () => {
  renderWorkspace();

  expect(screen.getByRole("heading", { name: "生成工作台" })).toBeInTheDocument();
  expect(screen.getByText("江南烟雨")).toBeInTheDocument();
  expect(screen.getByLabelText("提示词")).toHaveValue("水墨山水长卷");
  expect(screen.getByText("示例图")).toBeInTheDocument();
  expect(screen.getByText("生成参考图")).toBeInTheDocument();
  expect(screen.getByText("生成参数")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始生成" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清空" })).not.toBeInTheDocument();
  expect(screen.queryByText(/字符数/)).not.toBeInTheDocument();
});

test("示例图可从第一张切换到第二张", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByAltText("提示词示例图")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-01.jpg",
  );

  await user.click(screen.getByRole("button", { name: "下一张示例图" }));

  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByAltText("提示词示例图")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-02.jpg",
  );
});

test("选择本地参考图后预览，删除和卸载时释放对象 URL", async () => {
  const user = userEvent.setup();
  const createObjectURL = vi.fn(() => "blob:reference-image");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const { unmount } = renderWorkspace();
  const file = new File(["image"], "reference.png", { type: "image/png" });

  await user.upload(screen.getByLabelText("上传生成参考图"), file);

  expect(createObjectURL).toHaveBeenCalledWith(file);
  expect(screen.getByAltText("生成参考图预览")).toHaveAttribute(
    "src",
    "blob:reference-image",
  );

  await user.click(screen.getByRole("button", { name: "删除生成参考图" }));
  expect(screen.queryByAltText("生成参考图预览")).not.toBeInTheDocument();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:reference-image");

  unmount();
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

test("空提示词禁用提交，填写提示词后显示本地提交反馈", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  const prompt = screen.getByLabelText("提示词");
  const submit = screen.getByRole("button", { name: "开始生成" });

  await user.clear(prompt);
  expect(submit).toBeDisabled();

  await user.type(prompt, "新的提示词");
  await user.click(submit);

  expect(screen.getByText("已创建本地生成任务（演示）")).toBeInTheDocument();
});

test("高级参数可展开和收起，且不显示随机种子", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  expect(screen.queryByLabelText("模型")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开高级参数" }));
  expect(screen.getByLabelText("模型")).toBeInTheDocument();
  expect(screen.getByLabelText("比例")).toBeInTheDocument();
  expect(screen.getByLabelText("分辨率")).toBeInTheDocument();
  expect(screen.getByLabelText("生成数量")).toBeInTheDocument();
  expect(screen.getByLabelText("思考级别")).toBeInTheDocument();
  expect(screen.queryByLabelText(/随机种子/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "收起高级参数" }));
  expect(screen.queryByLabelText("模型")).not.toBeInTheDocument();
});
