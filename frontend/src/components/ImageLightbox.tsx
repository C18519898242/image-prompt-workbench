import { useEffect } from "react";
import { createPortal } from "react-dom";

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
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 1;
  const safeIndex = Math.min(Math.max(currentIndex, 1), safeTotal);
  const canPrev = safeIndex > 1;
  const canNext = safeIndex < safeTotal;
  const canShow = Boolean(imageUrl && !imageFailed);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (canPrev) onPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (canNext) onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrev, onClose, onNext, onPrev]);

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const content = (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="大图预览"
    >
      <button
        type="button"
        className="image-lightbox-backdrop"
        aria-label="关闭遮罩"
        onClick={onClose}
      />

      <div className="image-lightbox-panel">
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M14.5 5.5 8 12l6.5 6.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9.5 5.5 16 12l-6.5 6.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
