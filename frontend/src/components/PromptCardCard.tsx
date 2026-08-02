import type { PromptCard } from "../api";

type PromptCardCardProps = {
  card: PromptCard;
  imageUrl: string | null;
  imageFailed: boolean;
  onImageError: () => void;
  onUsePrompt: () => void;
  onPreview?: () => void;
};

export function PromptCardCard({
  card,
  imageUrl,
  imageFailed,
  onImageError,
  onUsePrompt,
  onPreview,
}: PromptCardCardProps) {
  const summary =
    card.prompt_text.length > 80
      ? `${card.prompt_text.slice(0, 80)}…`
      : card.prompt_text;

  return (
    <article className="prompt-card">
      <div
        className="prompt-card-image-frame prompt-card-image-frame--4x3"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPreview?.();
        }}
        role={onPreview ? "button" : undefined}
        tabIndex={onPreview ? 0 : undefined}
        onKeyDown={
          onPreview
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onPreview();
                }
              }
            : undefined
        }
        aria-label={onPreview ? `预览 ${card.title}` : undefined}
      >
        {imageUrl && !imageFailed ? (
          <img
            className="prompt-card-image"
            src={imageUrl}
            alt=""
            onError={onImageError}
          />
        ) : (
          <span className="prompt-card-image-placeholder">暂无图片</span>
        )}
        {card.image_count > 1 && (
          <span className="prompt-card-count">共 {card.image_count} 张</span>
        )}
      </div>
      <div className="prompt-card-body">
        <h2 className="prompt-card-title">{card.title}</h2>
        {card.categories.length > 0 && (
          <ul className="prompt-card-tags">
            {card.categories.map((category) => (
              <li key={category.id}>{category.name}</li>
            ))}
          </ul>
        )}
        <p className="prompt-card-summary">{summary}</p>
        <button type="button" className="btn btn-primary" onClick={onUsePrompt}>
          使用此提示词
        </button>
      </div>
    </article>
  );
}
