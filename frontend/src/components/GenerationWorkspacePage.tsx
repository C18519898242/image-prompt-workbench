import { useEffect, useRef, useState } from "react";

import type { PromptCard } from "../api";
import { ImageLightbox } from "./ImageLightbox";

export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

type ReferenceImage = {
  name: string;
  url: string;
};

type AspectRatio =
  | "Auto"
  | "1:1"
  | "9:16"
  | "16:9"
  | "3:4"
  | "4:3"
  | "3:2"
  | "2:3"
  | "5:4"
  | "4:5"
  | "21:9"
  | "4:1"
  | "1:4"
  | "8:1"
  | "1:8";

type GenerationParams = {
  model: "Nano Banana 2";
  aspectRatio: AspectRatio;
  resolution: "1K" | "2K";
  quantity: "1" | "2" | "4";
  thinkingLevel: "低" | "中等" | "高";
};

const aspectRatioOptions: AspectRatio[] = [
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
];

const initialGenerationParams: GenerationParams = {
  model: "Nano Banana 2",
  aspectRatio: "Auto",
  resolution: "1K",
  quantity: "1",
  thinkingLevel: "中等",
};

/** 生成参考图上限（不再使用固定 4 格空槽） */
const maxReferenceImages = 8;

export function GenerationWorkspacePage({
  card,
  onBack,
}: GenerationWorkspacePageProps) {
  const images = Array.isArray(card.images) ? card.images : [];
  const [prompt, setPrompt] = useState(card.prompt_text ?? "");
  const [exampleImageIndex, setExampleImageIndex] = useState(0);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [generationParams, setGenerationParams] = useState<GenerationParams>(
    initialGenerationParams,
  );
  const [submitted, setSubmitted] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failedExampleKeys, setFailedExampleKeys] = useState<
    Record<string, true>
  >({});
  const referenceImageUrlsRef = useRef<string[]>([]);
  const safeIndex = Math.min(
    Math.max(exampleImageIndex, 0),
    Math.max(images.length - 1, 0),
  );
  const exampleImage = images[safeIndex];
  const exampleImageKey = `${card.id}:${safeIndex}`;
  const exampleImageFailed = Boolean(failedExampleKeys[exampleImageKey]);

  useEffect(() => {
    setPrompt(card.prompt_text ?? "");
    setExampleImageIndex(0);
    setSubmitted(false);
    setLightboxOpen(false);
    setFailedExampleKeys({});
  }, [card.id, card.prompt_text]);

  useEffect(() => {
    return () => {
      referenceImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const appendReferenceImages = (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setReferenceImages((current) => {
      const remaining = maxReferenceImages - current.length;
      if (remaining <= 0) {
        return current;
      }
      const nextImages = files.slice(0, remaining).map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      }));
      referenceImageUrlsRef.current = [
        ...referenceImageUrlsRef.current,
        ...nextImages.map((image) => image.url),
      ];
      return [...current, ...nextImages];
    });
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
      <nav className="generation-workspace-breadcrumb" aria-label="面包屑">
        <button type="button" className="generation-breadcrumb-link" onClick={onBack}>
          提示词库
        </button>
        <span className="generation-breadcrumb-sep" aria-hidden="true">
          {">"}
        </span>
        <span className="generation-breadcrumb-current">生成工作台</span>
        <span className="generation-breadcrumb-sep" aria-hidden="true">
          -
        </span>
        <span className="generation-breadcrumb-current" title={card.title}>
          {card.title}
        </span>
      </nav>
      <h1 className="generation-workspace-title">{card.title}</h1>

      <div className="generation-workspace-left">
        <section aria-labelledby="example-images-heading">
          <div className="generation-example-heading-row">
            <h2 id="example-images-heading">示例图</h2>
            {images.length > 0 && (
              <span className="generation-example-page-count">
                {safeIndex + 1} / {images.length}
              </span>
            )}
          </div>
          {exampleImage ? (
            <>
              <div className="generation-example-image-frame">
                <button
                  type="button"
                  className="generation-example-image-hit"
                  aria-label="全屏预览示例图"
                  onClick={() => setLightboxOpen(true)}
                >
                  {exampleImageFailed ? (
                    <span className="generation-example-image-empty">
                      暂无图片
                    </span>
                  ) : (
                    <img
                      src={exampleImage.url}
                      alt="提示词示例图"
                      onError={() =>
                        setFailedExampleKeys((current) =>
                          current[exampleImageKey]
                            ? current
                            : { ...current, [exampleImageKey]: true },
                        )
                      }
                    />
                  )}
                </button>
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="generation-example-nav generation-example-nav-prev"
                      aria-label="上一张示例图"
                      disabled={safeIndex === 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExampleImageIndex((index) => Math.max(0, index - 1));
                        event.currentTarget.blur();
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M14.5 5 8 12l6.5 7"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="generation-example-nav generation-example-nav-next"
                      aria-label="下一张示例图"
                      disabled={safeIndex >= images.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExampleImageIndex((index) =>
                          Math.min(images.length - 1, index + 1),
                        );
                        event.currentTarget.blur();
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M9.5 5 16 12l-6.5 7"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>
              <p className="generation-example-hint">仅用于理解效果</p>
            </>
          ) : (
            <p className="generation-example-hint">暂无示例图</p>
          )}
        </section>

        <div className="generation-prompt-field">
          <label htmlFor="generation-prompt-editor">提示词</label>
          <textarea
            id="generation-prompt-editor"
            className="generation-prompt-editor"
            aria-label="提示词"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setSubmitted(false);
            }}
          />
        </div>
      </div>

      <div className="generation-workspace-right">
        <section
          className="generation-reference-section"
          aria-labelledby="reference-images-heading"
        >
          <h2 id="reference-images-heading">生成参考图（可选）</h2>
          <p className="generation-reference-hint">
            可上传最多 {maxReferenceImages} 张参考图，帮助 AI 更好地理解你的需求
          </p>
          <input
            id="generation-reference-image-input"
            aria-label="上传生成参考图"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              // FileList 是 live 引用，必须在清空 input 前拷贝成数组
              const files = event.target.files
                ? Array.from(event.target.files)
                : [];
              event.target.value = "";
              if (files.length > 0) {
                appendReferenceImages(files);
              }
            }}
          />
          {referenceImages.length > 0 && (
            <div className="generation-reference-image-grid">
              {referenceImages.map((image) => (
                <div
                  className="generation-reference-image-card"
                  key={image.url}
                >
                  <img src={image.url} alt="生成参考图预览" />
                  <button
                    type="button"
                    className="generation-reference-image-remove"
                    aria-label={`删除生成参考图：${image.name}`}
                    onClick={() => removeReferenceImage(image.url)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {referenceImages.length < maxReferenceImages && (
            <label
              className="generation-reference-image-add-bar"
              htmlFor="generation-reference-image-input"
            >
              <span className="generation-reference-image-add-icon" aria-hidden="true">
                +
              </span>
              添加
            </label>
          )}
        </section>

        <section aria-labelledby="generation-parameters-heading">
          <h2 id="generation-parameters-heading">生成参数</h2>
          <div className="generation-parameter-fields">
            <label>
              模型
              <select
                value={generationParams.model}
                onChange={(event) =>
                  setGenerationParams((params) => ({
                    ...params,
                    model: event.target.value as GenerationParams["model"],
                  }))
                }
              >
                <option value="Nano Banana 2">Nano Banana 2</option>
              </select>
            </label>
            <label>
              比例
              <select
                value={generationParams.aspectRatio}
                onChange={(event) =>
                  setGenerationParams((params) => ({
                    ...params,
                    aspectRatio: event.target.value as AspectRatio,
                  }))
                }
              >
                {aspectRatioOptions.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label>
              分辨率
              <select
                value={generationParams.resolution}
                onChange={(event) =>
                  setGenerationParams((params) => ({
                    ...params,
                    resolution: event.target
                      .value as GenerationParams["resolution"],
                  }))
                }
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
              </select>
            </label>
            <label>
              生成数量
              <select
                value={generationParams.quantity}
                onChange={(event) =>
                  setGenerationParams((params) => ({
                    ...params,
                    quantity: event.target
                      .value as GenerationParams["quantity"],
                  }))
                }
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
              </select>
            </label>
            <label>
              思考级别
              <select
                value={generationParams.thinkingLevel}
                onChange={(event) =>
                  setGenerationParams((params) => ({
                    ...params,
                    thinkingLevel: event.target
                      .value as GenerationParams["thinkingLevel"],
                  }))
                }
              >
                <option value="低">低</option>
                <option value="中等">中等</option>
                <option value="高">高</option>
              </select>
            </label>
          </div>
          <button
            className="generation-parameters-submit"
            type="button"
            disabled={!prompt.trim()}
            onClick={() => setSubmitted(true)}
          >
            开始生成
          </button>
          {submitted && (
            <p className="generation-submission-feedback">
              已创建本地生成任务（演示）
            </p>
          )}
        </section>
      </div>

      {lightboxOpen && exampleImage && (
        <ImageLightbox
          title={card.title}
          imageUrl={exampleImageFailed ? null : exampleImage.url}
          imageFailed={exampleImageFailed}
          currentIndex={safeIndex + 1}
          total={images.length}
          onClose={() => setLightboxOpen(false)}
          onDownload={() => {
            if (exampleImageFailed) {
              return;
            }
            const link = document.createElement("a");
            link.href = exampleImage.url;
            link.download =
              exampleImage.path?.split("/").pop() ||
              `${card.title}-example.jpg`;
            link.rel = "noopener";
            document.body.appendChild(link);
            link.click();
            link.remove();
          }}
          onPrev={() =>
            setExampleImageIndex((index) => Math.max(0, index - 1))
          }
          onNext={() =>
            setExampleImageIndex((index) =>
              Math.min(images.length - 1, index + 1),
            )
          }
          onImageError={() =>
            setFailedExampleKeys((current) =>
              current[exampleImageKey]
                ? current
                : { ...current, [exampleImageKey]: true },
            )
          }
        />
      )}
    </section>
  );
}
