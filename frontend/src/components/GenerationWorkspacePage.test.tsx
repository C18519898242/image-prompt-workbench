import { render, screen, within } from "@testing-library/react";
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

function optionValues(label: string) {
  return Array.from(
    (screen.getByLabelText(label) as HTMLSelectElement).options,
    (option) => option.value,
  );
}

test("显示生成工作台的必要区域，且没有清空或字符数功能", () => {
  renderWorkspace();

  expect(screen.getByRole("navigation", { name: "面包屑" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提示词库" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "江南烟雨" })).toBeInTheDocument();
  expect(screen.getByLabelText("提示词")).toHaveValue("水墨山水长卷");
  expect(screen.getByText("示例图")).toBeInTheDocument();
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByText("生成参考图（可选）")).toBeInTheDocument();
  expect(screen.getByText("仅用于理解效果")).toBeInTheDocument();
  expect(screen.getByText("生成参数")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始生成" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清空" })).not.toBeInTheDocument();
  expect(screen.queryByText(/字符数/)).not.toBeInTheDocument();
});

test("示例图可从第一张切换到第二张", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  expect(screen.getByAltText("提示词示例图")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-01.jpg",
  );
  expect(
    screen.getByRole("button", { name: "全屏预览示例图" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "下一张示例图" }));

  expect(screen.getByAltText("提示词示例图")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-02.jpg",
  );
});

test("点击示例图打开与首页相同的全屏预览并可切换", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  await user.click(screen.getByRole("button", { name: "全屏预览示例图" }));
  const lightbox = screen.getByRole("dialog", { name: "大图预览" });
  expect(lightbox).toBeInTheDocument();
  expect(screen.getByText("1/2")).toBeInTheDocument();
  expect(lightbox.querySelector("img")).toHaveAttribute(
    "src",
    "/media/prompt-images/0001-01.jpg",
  );

  await user.click(screen.getByRole("button", { name: "下一张" }));
  expect(screen.getByText("2/2")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "大图预览" }).querySelector("img"),
  ).toHaveAttribute("src", "/media/prompt-images/0001-02.jpg");

  await user.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog", { name: "大图预览" })).not.toBeInTheDocument();
});

test("参考图默认仅一个添加按钮，上传后显示预览并可删除，最多 8 张", async () => {
  const user = userEvent.setup();
  const createObjectURL = vi.fn(
    (file: File) => `blob:${file.name}`,
  );
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const { unmount } = renderWorkspace();
  const firstFile = new File(["first"], "first.png", { type: "image/png" });
  const secondFile = new File(["second"], "second.png", { type: "image/png" });
  const thirdFile = new File(
    ["third"],
    "third.png",
    { type: "image/png" },
  );
  const input = screen.getByLabelText("上传生成参考图");

  expect(screen.getByText("可上传最多 8 张参考图，帮助 AI 更好地理解你的需求")).toBeInTheDocument();
  expect(screen.getAllByText("添加")).toHaveLength(1);
  expect(input).toHaveAttribute("multiple");

  await user.upload(input, [firstFile, secondFile]);

  expect(createObjectURL).toHaveBeenCalledWith(firstFile);
  expect(createObjectURL).toHaveBeenCalledWith(secondFile);
  expect(screen.getAllByAltText("生成参考图预览")).toHaveLength(2);
  expect(screen.getAllByText("添加")).toHaveLength(1);
  expect(
    screen.getAllByAltText("生成参考图预览")[0].parentElement,
  ).toHaveClass("generation-reference-image-card");

  await user.click(screen.getByRole("button", { name: "删除生成参考图：first.png" }));
  expect(screen.getAllByAltText("生成参考图预览")).toHaveLength(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:first.png");

  await user.upload(input, thirdFile);
  expect(createObjectURL).toHaveBeenCalledWith(thirdFile);
  expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:second.png");
  expect(screen.getAllByAltText("生成参考图预览")).toHaveLength(2);
  expect(screen.getAllByAltText("生成参考图预览")[0]).toHaveAttribute(
    "src",
    "blob:second.png",
  );
  expect(screen.getAllByAltText("生成参考图预览")[1]).toHaveAttribute(
    "src",
    "blob:third.png",
  );

  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:second.png");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:third.png");
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

test("基础参数始终可见且受控", async () => {
  const user = userEvent.setup();
  renderWorkspace();

  expect(screen.getByLabelText("模型")).toBeInTheDocument();
  expect(screen.getByLabelText("比例")).toBeInTheDocument();
  expect(screen.getByLabelText("分辨率")).toBeInTheDocument();
  expect(screen.getByLabelText("生成数量")).toBeInTheDocument();
  expect(screen.getByLabelText("思考级别")).toBeInTheDocument();
  expect(screen.getByLabelText("模型")).toHaveValue("Nano Banana 2");
  expect(screen.getByLabelText("比例")).toHaveValue("Auto");
  expect(screen.getByLabelText("分辨率")).toHaveValue("1K");
  expect(screen.getByLabelText("生成数量")).toHaveValue("1");
  expect(screen.getByLabelText("思考级别")).toHaveValue("中等");
  expect(optionValues("模型")).toEqual(["Nano Banana 2"]);
  expect(optionValues("比例")).toEqual([
    "Auto",
    "1:1",
    "9:16",
    "16:9",
    "3:4",
    "4:3",
    "3:2",
    "2:3",
    "5:4",
    "4:5",
    "21:9",
    "4:1",
    "1:4",
    "8:1",
    "1:8",
  ]);
  expect(optionValues("分辨率")).toEqual(["1K", "2K"]);
  expect(optionValues("生成数量")).toEqual(["1", "2", "4"]);
  expect(optionValues("思考级别")).toEqual(["低", "中等", "高"]);
  expect(screen.queryByRole("button", { name: "展开高级参数" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/随机种子/)).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("比例"), "9:16");
  await user.selectOptions(screen.getByLabelText("分辨率"), "2K");
  await user.selectOptions(screen.getByLabelText("生成数量"), "4");
  await user.selectOptions(screen.getByLabelText("思考级别"), "高");

  expect(screen.getByLabelText("比例")).toHaveValue("9:16");
  expect(screen.getByLabelText("分辨率")).toHaveValue("2K");
  expect(screen.getByLabelText("生成数量")).toHaveValue("4");
  expect(screen.getByLabelText("思考级别")).toHaveValue("高");
});

test("提交按钮和本地反馈位于参数面板内，且使用全宽主按钮样式", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  const parameters = screen.getByRole("region", { name: "生成参数" });
  const submit = within(parameters).getByRole("button", { name: "开始生成" });

  expect(screen.getAllByRole("button", { name: "开始生成" })).toHaveLength(1);
  expect(submit).toHaveClass("generation-parameters-submit");

  await user.click(submit);
  expect(within(parameters).getByText("已创建本地生成任务（演示）")).toBeInTheDocument();
});
