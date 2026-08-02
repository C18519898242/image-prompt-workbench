import { useEffect, useMemo, useState } from "react";

import { ApiError, getPromptCards, type PromptCard } from "../api";
import { useAuth } from "../auth/AuthContext";
import { PromptCardCard } from "./PromptCardCard";
import { PromptCardDialog } from "./PromptCardDialog";

type PromptCardBrowserProps = {
  token: string;
};

export function PromptCardBrowser({ token }: PromptCardBrowserProps) {
  const { clearToken } = useAuth();
  const [cards, setCards] = useState<PromptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(1);
  const [failedImages, setFailedImages] = useState<Record<string, true>>({});

  const markFailed = (key: string) => {
    setFailedImages((current) =>
      current[key] ? current : { ...current, [key]: true },
    );
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPromptCards(token)
      .then((items) => {
        if (!cancelled) {
          setCards(items);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          clearToken(token);
          return;
        }
        if (!cancelled) {
          setError("提示词卡片加载失败");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearToken, token]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  const openCard = (card: PromptCard) => {
    setSelectedCardId(card.id);
    setCurrentIndex(1);
  };

  const closeDialog = () => {
    setSelectedCardId(null);
    setCurrentIndex(1);
  };

  if (loading) {
    return <p className="prompt-card-status">正在加载提示词卡片…</p>;
  }

  if (error) {
    return (
      <p className="prompt-card-status" role="alert">
        {error}
      </p>
    );
  }

  if (cards.length === 0) {
    return <p className="prompt-card-status">暂无提示词卡片</p>;
  }

  return (
    <section className="prompt-card-browser">
      <div className="prompt-card-grid">
        {cards.map((card) => {
          const first = card.images[0];
          const key = imageKey(card.id, 1);
          return (
            <PromptCardCard
              key={card.id}
              card={card}
              imageUrl={first?.url ?? null}
              imageFailed={Boolean(failedImages[key])}
              onImageError={() => markFailed(key)}
              onOpen={() => openCard(card)}
            />
          );
        })}
      </div>

      {selectedCard && (
        <PromptCardDialog
          card={selectedCard}
          currentIndex={currentIndex}
          imageUrl={
            selectedCard.images.find((image) => image.index === currentIndex)
              ?.url ?? null
          }
          imageFailed={Boolean(
            failedImages[imageKey(selectedCard.id, currentIndex)],
          )}
          onImageError={() =>
            markFailed(imageKey(selectedCard.id, currentIndex))
          }
          thumbnailUrls={Object.fromEntries(
            selectedCard.images.map((image) => [image.index, image.url]),
          )}
          failedThumbnails={Object.fromEntries(
            selectedCard.images.map((image) => [
              image.index,
              Boolean(failedImages[imageKey(selectedCard.id, image.index)]),
            ]),
          )}
          onThumbnailError={(index) =>
            markFailed(imageKey(selectedCard.id, index))
          }
          onClose={closeDialog}
          onPrev={() => setCurrentIndex((index) => Math.max(1, index - 1))}
          onNext={() =>
            setCurrentIndex((index) =>
              Math.min(selectedCard.image_count, index + 1),
            )
          }
          onSelectIndex={setCurrentIndex}
        />
      )}
    </section>
  );
}

function imageKey(cardId: number, imageIndex: number): string {
  return `${cardId}:${imageIndex}`;
}
