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
  const canPrev = currentIndex > 1;
  const canNext = currentIndex < total;
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

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

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
            {total > 1 && (
              <span className="image-lightbox-counter">
                {currentIndex} / {total}
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
          {canPrev && (
            <button
              type="button"
              className="image-lightbox-nav image-lightbox-nav-prev"
              aria-label="上一张"
              onClick={onPrev}
            >
              ‹
            </button>
          )}

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

          {canNext && (
            <button
              type="button"
              className="image-lightbox-nav image-lightbox-nav-next"
              aria-label="下一张"
              onClick={onNext}
            >
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
