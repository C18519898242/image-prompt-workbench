import { useEffect } from "react";

type ImageLightboxProps = {
  title: string;
  imageUrl: string | null;
  imageFailed: boolean;
  currentIndex: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onImageError: () => void;
};

/**
 * 全屏大图预览：深色遮罩 + 居中图片 + 左右切换。
 * 不使用 Portal / 不改 document.body，避免白屏与无法关闭。
 */
export function ImageLightbox({
  title,
  imageUrl,
  imageFailed,
  currentIndex,
  total,
  onClose,
  onPrev,
  onNext,
  onImageError,
}: ImageLightboxProps) {
  const safeTotal = total > 0 ? total : 1;
  const safeIndex = Math.min(Math.max(currentIndex, 1), safeTotal);
  const canPrev = safeIndex > 1;
  const canNext = safeIndex < safeTotal;
  const canShow = Boolean(imageUrl && !imageFailed);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && canPrev) {
        onPrev();
      } else if (event.key === "ArrowRight" && canNext) {
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrev, onClose, onNext, onPrev]);

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="大图预览"
      onClick={onClose}
    >
      <div
        className="image-lightbox-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="image-lightbox-header">
          <div className="image-lightbox-meta">
            <h2 className="image-lightbox-title">{title}</h2>
            {safeTotal > 1 && (
              <span className="image-lightbox-counter">
                {safeIndex} / {safeTotal}
              </span>
            )}
          </div>
          <button
            type="button"
            className="image-lightbox-close"
            aria-label="关闭预览"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="image-lightbox-stage">
          <button
            type="button"
            className="image-lightbox-nav image-lightbox-nav-prev"
            aria-label="上一张"
            disabled={!canPrev}
            onClick={onPrev}
          >
            ‹
          </button>

          {canShow ? (
            <img
              className="image-lightbox-image"
              src={imageUrl!}
              alt={title}
              onError={onImageError}
            />
          ) : (
            <span className="image-lightbox-empty">暂无图片</span>
          )}

          <button
            type="button"
            className="image-lightbox-nav image-lightbox-nav-next"
            aria-label="下一张"
            disabled={!canNext}
            onClick={onNext}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
