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
 * YouMind 式全屏预览：
 * 近黑全屏底、顶部 1/N + 关闭、两侧圆角箭头、中间大图。
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
      {/* 顶栏：左计数 右关闭，贴近 YouMind */}
      <div
        className="image-lightbox-topbar"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="image-lightbox-counter" title={title}>
          {safeIndex}/{safeTotal}
        </span>
        <button
          type="button"
          className="image-lightbox-close"
          aria-label="关闭预览"
          onClick={onClose}
        >
          ×
        </button>
      </div>

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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14.5 5 8 12l6.5 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9.5 5 16 12l-6.5 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
