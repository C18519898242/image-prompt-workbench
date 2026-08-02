import { useEffect, useRef, useState } from "react";

import type { PromptCard } from "../api";

export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

export function GenerationWorkspacePage({
  card,
  onBack,
}: GenerationWorkspacePageProps) {
  const [prompt, setPrompt] = useState(card.prompt_text);
  const [exampleImageIndex, setExampleImageIndex] = useState(0);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [showAdvancedParameters, setShowAdvancedParameters] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const referenceImageUrlRef = useRef<string | null>(null);
  const exampleImage = card.images[exampleImageIndex];

  useEffect(() => {
    return () => {
      if (referenceImageUrlRef.current) {
        URL.revokeObjectURL(referenceImageUrlRef.current);
      }
    };
  }, []);

  const replaceReferenceImage = (file: File) => {
    if (referenceImageUrlRef.current) {
      URL.revokeObjectURL(referenceImageUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    referenceImageUrlRef.current = url;
    setReferenceImageUrl(url);
  };

  const removeReferenceImage = () => {
    if (referenceImageUrlRef.current) {
      URL.revokeObjectURL(referenceImageUrlRef.current);
      referenceImageUrlRef.current = null;
    }
    setReferenceImageUrl(null);
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
            <div className="generation-example-image-frame generation-example-image-frame--4x3">
              <img src={exampleImage.url} alt="提示词示例图" />
            </div>
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
        <h2 id="reference-images-heading">生成参考图</h2>
        <label>
          上传生成参考图
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                replaceReferenceImage(file);
              }
              event.target.value = "";
            }}
          />
        </label>
        {referenceImageUrl && (
          <div>
            <img src={referenceImageUrl} alt="生成参考图预览" />
            <button type="button" onClick={removeReferenceImage}>
              删除生成参考图
            </button>
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
              <select defaultValue="seedream">
                <option value="seedream">Seedream</option>
              </select>
            </label>
            <label>
              比例
              <select defaultValue="1:1">
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
            <label>
              分辨率
              <select defaultValue="1024">
                <option value="1024">1024</option>
                <option value="2048">2048</option>
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
              <select defaultValue="标准">
                <option value="标准">标准</option>
                <option value="深入">深入</option>
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
