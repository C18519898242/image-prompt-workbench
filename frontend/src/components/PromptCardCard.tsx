import type { PromptCard } from "../api";

type PromptCardCardProps = {
  card: PromptCard;
  imageUrl: string | null;
  imageFailed: boolean;
  onOpen: () => void;
};

export function PromptCardCard({
  card,
  imageUrl,
  imageFailed,
  onOpen,
}: PromptCardCardProps) {
  const summary =
    card.prompt_text.length > 80
      ? `${card.prompt_text.slice(0, 80)}…`
      : card.prompt_text;

  return (
    <button
      type="button"
      className="prompt-card"
      onClick={onOpen}
      aria-label={card.title}
    >
      <div className="prompt-card-image-frame">
        {imageUrl && !imageFailed ? (
          <img className="prompt-card-image" src={imageUrl} alt="" />
        ) : (
          <span className="prompt-card-image-placeholder">暂无图片</span>
        )}
        {card.image_count > 1 && (
          <span className="prompt-card-count">共 {card.image_count} 张</span>
        )}
      </div>
      <h2 className="prompt-card-title">{card.title}</h2>
      <p className="prompt-card-summary">{summary}</p>
    </button>
  );
}
