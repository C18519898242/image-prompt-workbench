import type { PromptCard } from "../api";

type PromptCardDialogProps = {
  card: PromptCard;
  currentIndex: number;
  imageUrl: string | null;
  imageFailed: boolean;
  thumbnailUrls: Record<number, string | null>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (index: number) => void;
};

export function PromptCardDialog({
  card,
  currentIndex,
  imageUrl,
  imageFailed,
  thumbnailUrls,
  onClose,
  onPrev,
  onNext,
  onSelectIndex,
}: PromptCardDialogProps) {
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
          <button type="button" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>

        <div className="prompt-card-stage">
          {imageUrl && !imageFailed ? (
            <img src={imageUrl} alt="" />
          ) : (
            <span className="prompt-card-image-placeholder">暂无图片</span>
          )}
        </div>

        <div className="prompt-card-carousel-controls">
          <button type="button" onClick={onPrev} disabled={currentIndex <= 1}>
            上一张
          </button>
          <span>
            {currentIndex} / {card.image_count}
          </span>
          <button
            type="button"
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
                  {thumb ? (
                    <img src={thumb} alt="" />
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

        <a
          className="prompt-card-try-link"
          href={`https://youmind.com/zh-CN/nano-banana-pro-prompts?q=${encodeURIComponent(card.title)}`}
          target="_blank"
          rel="noreferrer"
        >
          立即尝试
        </a>
      </div>
    </div>
  );
}
