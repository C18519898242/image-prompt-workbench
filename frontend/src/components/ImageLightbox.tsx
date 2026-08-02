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
 * 全屏画廊预览（无对话框卡片感）：
 * 全屏深色遮罩 + 居中大图 + 两侧箭头 + 右上关闭。
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
      <header
        className="image-lightbox-topbar"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="image-lightbox-meta">
          <span className="image-lightbox-title">{title}</span>
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

      <button
        type="button"
        className="image-lightbox-nav image-lightbox-nav-prev"
        aria-label="上一张"
        disabled={!canPrev}
        onClick={(event) => {
          event.stopPropagation();
          onPrev();
        }}
      >
        ‹
      </button>

      <div
        className="image-lightbox-stage"
        onClick={(event) => event.stopPropagation()}
      >
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
      </div>

      <button
        type="button"
        className="image-lightbox-nav image-lightbox-nav-next"
        aria-label="下一张"
        disabled={!canNext}
        onClick={(event) => {
          event.stopPropagation();
          onNext();
        }}
      >
        ›
      </button>
    </div>
  );
}
