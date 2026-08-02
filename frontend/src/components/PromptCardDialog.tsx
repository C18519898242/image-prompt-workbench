import { useEffect, useState } from "react";

import type { PromptCard } from "../api";

type PromptCardDialogProps = {
  card: PromptCard;
  currentIndex: number;
  imageUrl: string | null;
  imageFailed: boolean;
  onImageError: () => void;
  thumbnailUrls: Record<number, string | null>;
  failedThumbnails: Record<number, boolean>;
  onThumbnailError: (index: number) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (index: number) => void;
  onUsePrompt?: () => void;
};

export function PromptCardDialog({
  card,
  currentIndex,
  imageUrl,
  imageFailed,
  onImageError,
  thumbnailUrls,
  failedThumbnails,
  onThumbnailError,
  onClose,
  onPrev,
  onNext,
  onSelectIndex,
  onUsePrompt,
}: PromptCardDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setPreviewOpen(false);
  }, [currentIndex, card.id]);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  const canPreview = Boolean(imageUrl && !imageFailed);

  return (
    <div className="prompt-card-dialog-backdrop" role="presentation">
      <div
        className="prompt-card-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-card-dialog-title"
      >
        <div className="prompt-card-dialog-header">
          <h2 id="prompt-card-dialog-title">{card.title}</h2>
          <button type="button" className="btn btn-secondary" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>

        <div className="prompt-card-stage">
          {canPreview ? (
            <button
              type="button"
              className="prompt-card-stage-hit"
              onClick={() => setPreviewOpen(true)}
              aria-label="预览大图"
            >
              <img src={imageUrl!} alt="" onError={onImageError} />
            </button>
          ) : (
            <span className="prompt-card-image-placeholder">暂无图片</span>
          )}
        </div>

        <div className="prompt-card-carousel-controls">
          <button type="button" className="btn btn-secondary" onClick={onPrev} disabled={currentIndex <= 1}>
            上一张
          </button>
          <span>
            {currentIndex} / {card.image_count}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onNext}
            disabled={currentIndex >= card.image_count}
          >
            下一张
          </button>
        </div>

        {card.image_count > 1 && (
          <div className="prompt-card-thumbnails">
            {card.images.map((image) => {
              const thumb = thumbnailUrls[image.index];
              const failed = failedThumbnails[image.index];
              return (
                <button
                  key={image.index}
                  type="button"
                  className={
                    image.index === currentIndex
                      ? "prompt-card-thumb is-active"
                      : "prompt-card-thumb"
                  }
                  onClick={() => onSelectIndex(image.index)}
                  aria-label={`第 ${image.index} 张`}
                >
                  {thumb && !failed ? (
                    <img
                      src={thumb}
                      alt=""
                      onError={() => onThumbnailError(image.index)}
                    />
                  ) : (
                    <span>{image.index}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <section className="prompt-card-dialog-prompt">
          <h3>提示词</h3>
          <pre>{card.prompt_text}</pre>
        </section>

        {onUsePrompt && (
          <button type="button" className="btn btn-primary" onClick={onUsePrompt}>
            使用此提示词
          </button>
        )}
      </div>

      {previewOpen && canPreview && (
        <div
          className="prompt-card-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="大图预览"
          onClick={() => setPreviewOpen(false)}
        >
          <button
            type="button"
            className="prompt-card-lightbox-close btn btn-secondary"
            aria-label="关闭预览"
            onClick={() => setPreviewOpen(false)}
          >
            关闭
          </button>
          <img
            className="prompt-card-lightbox-image"
            src={imageUrl!}
            alt={card.title}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
