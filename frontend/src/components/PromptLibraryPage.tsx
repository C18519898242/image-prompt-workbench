import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  getCategories,
  getPromptCards,
  type Category,
  type PromptCard,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import { ImageLightbox } from "./ImageLightbox";
import { PromptCardCard } from "./PromptCardCard";

export type LibraryFilters = {
  query: string;
  categoryId: number | null;
  sort: "newest" | "oldest" | "title";
};

export const defaultLibraryFilters: LibraryFilters = {
  query: "",
  categoryId: null,
  sort: "newest",
};

type PromptLibraryPageProps = {
  token: string;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  onUsePrompt: (card: PromptCard) => void;
};

export function filterPromptCards(
  cards: PromptCard[],
  filters: LibraryFilters,
): PromptCard[] {
  let result = cards;
  const query = filters.query.trim().toLowerCase();
  if (query) {
    result = result.filter(
      (card) =>
        card.title.toLowerCase().includes(query) ||
        card.prompt_text.toLowerCase().includes(query),
    );
  }
  if (filters.categoryId != null) {
    result = result.filter((card) =>
      card.category_ids.includes(filters.categoryId!),
    );
  }
  const sorted = [...result];
  if (filters.sort === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  } else if (filters.sort === "oldest") {
    sorted.sort((a, b) => a.id - b.id);
  } else {
    sorted.sort((a, b) => b.id - a.id);
  }
  return sorted;
}

export function PromptLibraryPage({
  token,
  filters,
  onFiltersChange,
  onUsePrompt,
}: PromptLibraryPageProps) {
  const { clearToken } = useAuth();
  const [cards, setCards] = useState<PromptCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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

    void Promise.all([getPromptCards(token), getCategories(token)])
      .then(([items, categoryItems]) => {
        if (!cancelled) {
          setCards(items);
          setCategories(categoryItems);
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

  const visibleCards = useMemo(
    () => filterPromptCards(cards, filters),
    [cards, filters],
  );

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  if (loading) {
    return <p className="prompt-card-status">正在加载提示词…</p>;
  }

  if (error) {
    return (
      <p className="prompt-card-status" role="alert">
        {error}
      </p>
    );
  }

  return (
    <section className="prompt-library-page">
      <div className="library-toolbar">
        <input
          className="library-search"
          type="search"
          value={filters.query}
          onChange={(event) =>
            onFiltersChange({ ...filters, query: event.target.value })
          }
          placeholder="搜索提示词关键词，如：古风 山水 夜景"
          aria-label="搜索提示词"
        />
        <select
          className="library-sort"
          value={filters.sort}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              sort: event.target.value as LibraryFilters["sort"],
            })
          }
          aria-label="排序"
        >
          <option value="newest">最新</option>
          <option value="oldest">最旧</option>
          <option value="title">标题</option>
        </select>
      </div>

      <div className="library-filters">
        <button
          type="button"
          className={
            filters.categoryId == null
              ? "library-chip is-active"
              : "library-chip"
          }
          onClick={() => onFiltersChange({ ...filters, categoryId: null })}
        >
          全部
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={
              filters.categoryId === category.id
                ? "library-chip is-active"
                : "library-chip"
            }
            onClick={() =>
              onFiltersChange({ ...filters, categoryId: category.id })
            }
          >
            {category.name}
          </button>
        ))}
      </div>

      {cards.length === 0 ? (
        <p className="prompt-card-status">暂无提示词卡片</p>
      ) : visibleCards.length === 0 ? (
        <p className="prompt-card-status">没有符合条件的提示词</p>
      ) : (
        <div className="prompt-card-grid">
          {visibleCards.map((card) => {
            const first = card.images[0];
            const key = imageKey(card.id, 1);
            return (
              <PromptCardCard
                key={card.id}
                card={card}
                imageUrl={first?.url ?? null}
                imageFailed={Boolean(failedImages[key])}
                onImageError={() => markFailed(key)}
                onUsePrompt={() => onUsePrompt(card)}
                onPreview={() => {
                  setSelectedCardId(card.id);
                  setCurrentIndex(1);
                }}
              />
            );
          })}
        </div>
      )}

      {selectedCard && (
        <ImageLightbox
          title={selectedCard.title}
          currentIndex={currentIndex}
          total={selectedCard.image_count || 1}
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
          onClose={() => {
            setSelectedCardId(null);
            setCurrentIndex(1);
          }}
          onPrev={() => setCurrentIndex((index) => Math.max(1, index - 1))}
          onNext={() =>
            setCurrentIndex((index) =>
              Math.min(selectedCard.image_count || 1, index + 1),
            )
          }
        />
      )}
    </section>
  );
}

function imageKey(cardId: number, imageIndex: number): string {
  return `${cardId}:${imageIndex}`;
}
