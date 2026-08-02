import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  fetchImageObjectUrl,
  getPromptCards,
  type PromptCard,
} from "../api";
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
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Record<string, true>>({});

  const rememberObjectUrl = useCallback((key: string, url: string) => {
    setObjectUrls((current) => {
      if (current[key] === url) {
        return current;
      }
      if (current[key]) {
        URL.revokeObjectURL(current[key]);
      }
      return { ...current, [key]: url };
    });
  }, []);

  const markFailed = useCallback((key: string) => {
    setFailedImages((current) =>
      current[key] ? current : { ...current, [key]: true },
    );
  }, []);

  const loadImage = useCallback(
    async (key: string, imageUrl: string) => {
      if (objectUrls[key] || failedImages[key]) {
        return;
      }
      try {
        const objectUrl = await fetchImageObjectUrl(token, imageUrl);
        rememberObjectUrl(key, objectUrl);
      } catch (requestError: unknown) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          clearToken(token);
          return;
        }
        markFailed(key);
      }
    },
    [
      clearToken,
      failedImages,
      markFailed,
      objectUrls,
      rememberObjectUrl,
      token,
    ],
  );

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

  useEffect(() => {
    return () => {
      for (const url of Object.values(objectUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [objectUrls]);

  // 列表仅预加载每张卡片第一张图
  useEffect(() => {
    for (const card of cards) {
      const first = card.images[0];
      if (first) {
        void loadImage(imageKey(card.id, first.index), first.url);
      }
    }
  }, [cards, loadImage]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  // 弹窗打开后加载当前图与缩略图
  useEffect(() => {
    if (!selectedCard) {
      return;
    }
    for (const image of selectedCard.images) {
      void loadImage(imageKey(selectedCard.id, image.index), image.url);
    }
  }, [loadImage, selectedCard]);

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
          const key = imageKey(card.id, 1);
          return (
            <PromptCardCard
              key={card.id}
              card={card}
              imageUrl={objectUrls[key] ?? null}
              imageFailed={Boolean(failedImages[key])}
              onOpen={() => openCard(card)}
            />
          );
        })}
      </div>

      {selectedCard && (
        <PromptCardDialog
          card={selectedCard}
          currentIndex={currentIndex}
          imageUrl={objectUrls[imageKey(selectedCard.id, currentIndex)] ?? null}
          imageFailed={Boolean(
            failedImages[imageKey(selectedCard.id, currentIndex)],
          )}
          thumbnailUrls={Object.fromEntries(
            selectedCard.images.map((image) => [
              image.index,
              objectUrls[imageKey(selectedCard.id, image.index)] ?? null,
            ]),
          )}
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
