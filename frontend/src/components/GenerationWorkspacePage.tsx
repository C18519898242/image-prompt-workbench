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

type GenerationParams = {
  model: "Nano Banana 2";
  aspectRatio: "1:1" | "4:3" | "16:9";
  resolution: "1K" | "2K";
  quantity: "1" | "2" | "4";
  thinkingLevel: "低" | "中等" | "高";
};

const initialGenerationParams: GenerationParams = {
  model: "Nano Banana 2",
  aspectRatio: "4:3",
  resolution: "1K",
  quantity: "1",
  thinkingLevel: "中等",
};

const initialReferenceImageSlots = 4;

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
  const referenceImageUrlsRef = useRef<string[]>([]);
  const safeIndex = Math.min(
    Math.max(exampleImageIndex, 0),
    Math.max(images.length - 1, 0),
  );
  const exampleImage = images[safeIndex];

  useEffect(() => {
    setPrompt(card.prompt_text ?? "");
    setExampleImageIndex(0);
    setSubmitted(false);
  }, [card.id, card.prompt_text]);

  useEffect(() => {
    return () => {
      referenceImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const appendReferenceImages = (files: FileList) => {
    const nextImages = Array.from(files).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    referenceImageUrlsRef.current = [
      ...referenceImageUrlsRef.current,
      ...nextImages.map((image) => image.url),
    ];
    setReferenceImages((images) => [...images, ...nextImages]);
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

      <div className="generation-workspace-left">
        <section aria-labelledby="example-images-heading">
          <h2 id="example-images-heading">示例图</h2>
          {exampleImage ? (
            <>
              <div className="generation-example-image-frame">
                {/* wrap 仅包住实际图片区域，两侧留白不触发箭头显示 */}
                <div className="generation-example-image-wrap">
                  <img src={exampleImage.url} alt="提示词示例图" />
                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="generation-example-nav generation-example-nav-prev"
                        aria-label="上一张示例图"
                        disabled={safeIndex === 0}
                        onClick={(event) => {
                          setExampleImageIndex((index) =>
                            Math.max(0, index - 1),
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
        <section aria-labelledby="reference-images-heading">
          <h2 id="reference-images-heading">生成参考图（可选）</h2>
          <input
            id="generation-reference-image-input"
            aria-label="上传生成参考图"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) {
                appendReferenceImages(files);
              }
              event.target.value = "";
            }}
          />
          <div className="generation-reference-image-grid">
            {referenceImages.map((image) => (
              <div className="generation-reference-image-card" key={image.url}>
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
            {Array.from({
              length: Math.max(
                1,
                initialReferenceImageSlots - referenceImages.length,
              ),
            }).map((_, index) => (
              <label
                className="generation-reference-image-add-card"
                htmlFor="generation-reference-image-input"
                key={`reference-image-add-${index}`}
              >
                添加
              </label>
            ))}
          </div>
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
                    aspectRatio: event.target
                      .value as GenerationParams["aspectRatio"],
                  }))
                }
              >
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
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
    </section>
  );
}
