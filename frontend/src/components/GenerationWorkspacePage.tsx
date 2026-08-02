import { useEffect, useRef, useState } from "react";

import type { PromptCard } from "../api";

export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

type ReferenceImage = {
  name: string;
  url: string;
};

export function GenerationWorkspacePage({
  card,
  onBack,
}: GenerationWorkspacePageProps) {
  const [prompt, setPrompt] = useState(card.prompt_text);
  const [exampleImageIndex, setExampleImageIndex] = useState(0);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [showAdvancedParameters, setShowAdvancedParameters] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const referenceImageUrlsRef = useRef<string[]>([]);
  const exampleImage = card.images[exampleImageIndex];

  useEffect(() => {
    return () => {
      referenceImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const replaceReferenceImages = (files: FileList) => {
    referenceImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    const nextImages = Array.from(files).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    referenceImageUrlsRef.current = nextImages.map((image) => image.url);
    setReferenceImages(nextImages);
  };

  const removeReferenceImage = (url: string) => {
    URL.revokeObjectURL(url);
    referenceImageUrlsRef.current = referenceImageUrlsRef.current.filter(
      (currentUrl) => currentUrl !== url,
    );
    setReferenceImages((images) => images.filter((image) => image.url !== url));
  };

  return (
    <section className="generation-workspace">
      <button type="button" onClick={onBack}>
        返回提示词库
      </button>
      <h1>生成工作台</h1>
      <p>{card.title}</p>

      <section aria-labelledby="example-images-heading">
        <h2 id="example-images-heading">示例图</h2>
        {exampleImage ? (
          <>
            <div
              className="generation-example-image-frame generation-example-image-frame--4x3"
              style={{ aspectRatio: "4 / 3" }}
            >
              <img
                src={exampleImage.url}
                alt="提示词示例图"
                style={{ objectFit: "contain" }}
              />
            </div>
            <p>仅用于理解效果</p>
            <div>
              <button
                type="button"
                aria-label="上一张示例图"
                disabled={exampleImageIndex === 0}
                onClick={() => setExampleImageIndex((index) => index - 1)}
              >
                上一张
              </button>
              <span>
                {exampleImageIndex + 1} / {card.images.length}
              </span>
              <button
                type="button"
                aria-label="下一张示例图"
                disabled={exampleImageIndex >= card.images.length - 1}
                onClick={() => setExampleImageIndex((index) => index + 1)}
              >
                下一张
              </button>
            </div>
          </>
        ) : (
          <p>暂无示例图</p>
        )}
      </section>

      <label>
        提示词
        <textarea
          className="generation-prompt-editor"
          aria-label="提示词"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setSubmitted(false);
          }}
        />
      </label>

      <section aria-labelledby="reference-images-heading">
        <h2 id="reference-images-heading">生成参考图（可选）</h2>
        <label>
          上传生成参考图
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) {
                replaceReferenceImages(files);
              }
              event.target.value = "";
            }}
          />
        </label>
        {referenceImages.length > 0 && (
          <div
            className="generation-reference-image-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            {referenceImages.map((image) => (
              <div key={image.url}>
                <img src={image.url} alt="生成参考图预览" />
                <button
                  type="button"
                  aria-label={`删除生成参考图：${image.name}`}
                  onClick={() => removeReferenceImage(image.url)}
                >
                  删除生成参考图
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="generation-parameters-heading">
        <h2 id="generation-parameters-heading">生成参数</h2>
        <button
          type="button"
          aria-expanded={showAdvancedParameters}
          onClick={() => setShowAdvancedParameters((visible) => !visible)}
        >
          {showAdvancedParameters ? "收起高级参数" : "展开高级参数"}
        </button>
        {showAdvancedParameters && (
          <div>
            <label>
              模型
              <select defaultValue="Nano Banana 2">
                <option value="Nano Banana 2">Nano Banana 2</option>
              </select>
            </label>
            <label>
              比例
              <select defaultValue="4:3">
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
            <label>
              分辨率
              <select defaultValue="1K">
                <option value="1K">1K</option>
                <option value="2K">2K</option>
              </select>
            </label>
            <label>
              生成数量
              <select defaultValue="1">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
              </select>
            </label>
            <label>
              思考级别
              <select defaultValue="中等">
                <option value="低">低</option>
                <option value="中等">中等</option>
                <option value="高">高</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <button
        type="button"
        disabled={!prompt.trim()}
        onClick={() => setSubmitted(true)}
      >
        开始生成
      </button>
      {submitted && <p>已创建本地生成任务（演示）</p>}
    </section>
  );
}
