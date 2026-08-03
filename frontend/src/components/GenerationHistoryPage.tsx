import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  deleteGenerationHistory,
  getGenerationHistories,
  getPromptCards,
  type GenerationHistoryItem,
  type PromptCard,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import type { SessionGenerationCard } from "../generation";
import { ImageLightbox } from "./ImageLightbox";

export type HistoryFilters = {
  query: string;
  timeRange: "all" | "today" | "week" | "month";
  model: string;
  aspectRatio: string;
  /** 服务端筛选：GET /api/generation-history?prompt_card_id= */
  promptCardId: number | null;
  sort: "newest" | "oldest";
};

export const defaultHistoryFilters: HistoryFilters = {
  query: "",
  timeRange: "all",
  model: "",
  aspectRatio: "",
  promptCardId: null,
  sort: "newest",
};

export type HistoryDisplayItem = {
  key: string;
  status: "loading" | "failed" | "completed";
  promptCardId: number;
  title: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  createdAtMs: number;
  sequence: number;
  history?: GenerationHistoryItem;
};

type GenerationHistoryPageProps = {
  token: string;
  initialPromptCardId?: number | null;
  sessionCards?: SessionGenerationCard[];
};

/** 从 API 组合标题中取出提示词卡片名（去掉尾部 Unix 时间戳）。 */
export function displayHistoryTitle(item: GenerationHistoryItem): string {
  const suffix = ` ${item.created_at}`;
  if (item.title.endsWith(suffix)) {
    return item.title.slice(0, -suffix.length);
  }
  return item.title;
}

export function formatHistoryDateTime(createdAt: number): string {
  const date = new Date(createdAt * 1000);
  if (Number.isNaN(date.getTime())) {
    return String(createdAt);
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function startOfLocalDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function buildHistoryDisplayItems(
  persisted: GenerationHistoryItem[],
  sessionCards: SessionGenerationCard[],
): HistoryDisplayItem[] {
  const sessionHistoryIds = new Set(
    sessionCards.flatMap((card) => (card.history ? [card.history.id] : [])),
  );
  const sessionEntries = sessionCards.map(
    (card): HistoryDisplayItem => ({
      key: `session-${card.clientId}`,
      status: card.status,
      promptCardId: card.promptCardId,
      title: card.title,
      model: card.model,
      aspectRatio: card.aspectRatio,
      resolution: card.resolution,
      createdAtMs: card.createdAtMs,
      sequence: card.sequence,
      history: card.history,
    }),
  );
  const persistedEntries = persisted
    .filter((item) => !sessionHistoryIds.has(item.id))
    .map(
      (item): HistoryDisplayItem => ({
        key: `history-${item.id}`,
        status: "completed",
        promptCardId: item.prompt_card_id,
        title: displayHistoryTitle(item),
        model: item.model,
        aspectRatio: item.aspect_ratio,
        resolution: item.resolution,
        createdAtMs: item.created_at * 1000,
        sequence: item.id,
        history: item,
      }),
    );
  return [...sessionEntries, ...persistedEntries];
}

export function filterHistoryDisplayItems(
  items: HistoryDisplayItem[],
  filters: HistoryFilters,
): HistoryDisplayItem[] {
  const query = filters.query.trim().toLowerCase();
  const todayStart = startOfLocalDay(Date.now());
  const days = filters.timeRange === "week" ? 6 : 29;
  const minCreatedAtMs =
    filters.timeRange === "today"
      ? todayStart
      : filters.timeRange === "all"
        ? 0
        : todayStart - days * 24 * 60 * 60 * 1000;
  return items
    .filter((item) => {
      const haystack =
        `${item.title} ${item.model} ${item.aspectRatio}`.toLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (filters.timeRange === "all" || item.createdAtMs >= minCreatedAtMs) &&
        (!filters.model || item.model === filters.model) &&
        (!filters.aspectRatio || item.aspectRatio === filters.aspectRatio) &&
        (filters.promptCardId == null ||
          item.promptCardId === filters.promptCardId)
      );
    })
    .sort((left, right) => {
      const direction = filters.sort === "oldest" ? 1 : -1;
      return (
        direction *
        (left.createdAtMs - right.createdAtMs || left.sequence - right.sequence)
      );
    });
}

/** 兼容 wrapper：仅对已持久化历史做过滤排序。 */
export function filterHistoryItems(
  items: GenerationHistoryItem[],
  filters: HistoryFilters,
): GenerationHistoryItem[] {
  return filterHistoryDisplayItems(
    buildHistoryDisplayItems(items, []),
    filters,
  ).flatMap((item) => (item.history ? [item.history] : []));
}

function downloadHistoryImage(item: GenerationHistoryItem): void {
  const link = document.createElement("a");
  link.href = item.url;
  const baseName =
    item.image_path.split("/").pop() || `history-${item.id}.png`;
  link.download = baseName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function GenerationHistoryPage({
  token,
  initialPromptCardId = null,
  sessionCards = [],
}: GenerationHistoryPageProps) {
  const { clearToken } = useAuth();
  const [items, setItems] = useState<GenerationHistoryItem[]>([]);
  const [promptCards, setPromptCards] = useState<PromptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(() => ({
    ...defaultHistoryFilters,
    promptCardId: initialPromptCardId ?? null,
  }));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, true>>({});

  useEffect(() => {
    let cancelled = false;

    void getPromptCards(token)
      .then((cards) => {
        if (!cancelled) {
          setPromptCards(cards);
        }
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          clearToken(token);
          return;
        }
        if (!cancelled) {
          setPromptCards([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearToken, token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const options =
      filters.promptCardId != null
        ? { prompt_card_id: filters.promptCardId }
        : undefined;

    void getGenerationHistories(token, options)
      .then((historyItems) => {
        if (!cancelled) {
          setItems(historyItems);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) {
          clearToken(token);
          return;
        }
        if (!cancelled) {
          setError("生成历史加载失败");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearToken, filters.promptCardId, token]);

  const displayItems = useMemo(
    () => buildHistoryDisplayItems(items, sessionCards),
    [items, sessionCards],
  );

  const visibleDisplayItems = useMemo(
    () => filterHistoryDisplayItems(displayItems, filters),
    [displayItems, filters],
  );

  const visibleCompletedItems = useMemo(
    () =>
      visibleDisplayItems.flatMap((entry) =>
        entry.status === "completed" && entry.history ? [entry.history] : [],
      ),
    [visibleDisplayItems],
  );

  const modelOptions = useMemo(() => {
    return Array.from(new Set(displayItems.map((item) => item.model))).sort(
      (a, b) => a.localeCompare(b, "zh"),
    );
  }, [displayItems]);

  const ratioOptions = useMemo(() => {
    return Array.from(
      new Set(displayItems.map((item) => item.aspectRatio)),
    ).sort((a, b) => a.localeCompare(b, "zh"));
  }, [displayItems]);

  const selectedIndex = useMemo(() => {
    if (selectedId == null) {
      return -1;
    }
    return visibleCompletedItems.findIndex((item) => item.id === selectedId);
  }, [selectedId, visibleCompletedItems]);

  const selectedItem =
    selectedIndex >= 0 ? visibleCompletedItems[selectedIndex] : null;

  useEffect(() => {
    if (selectedId == null) {
      setLightboxOpen(false);
      return;
    }
    if (!visibleCompletedItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setLightboxOpen(false);
    }
  }, [selectedId, visibleCompletedItems]);

  const markImageFailed = (id: number) => {
    setFailedImages((current) =>
      current[id] ? current : { ...current, [id]: true },
    );
  };

  const selectHistoryItem = (id: number) => {
    setSelectedId(id);
    setActionError(null);
  };

  const handleDelete = async () => {
    if (!selectedItem || deleting) {
      return;
    }
    const confirmed = window.confirm(
      "确定删除这条生成历史？图片文件将一并删除。",
    );
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await deleteGenerationHistory(token, selectedItem.id);
      setItems((current) =>
        current.filter((item) => item.id !== selectedItem.id),
      );
      setSelectedId(null);
      setLightboxOpen(false);
    } catch (requestError: unknown) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        clearToken(token);
        return;
      }
      setActionError("删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  };

  if (loading && sessionCards.length === 0) {
    return <p className="prompt-card-status">正在加载生成历史…</p>;
  }

  if (error && sessionCards.length === 0) {
    return (
      <p className="prompt-card-status" role="alert">
        {error}
      </p>
    );
  }

  return (
    <section className="history-page">
      <header className="history-page-header">
        <h1 className="history-page-title">生成历史</h1>
      </header>

      {error && sessionCards.length > 0 && (
        <p className="prompt-card-status" role="alert">
          {error}
        </p>
      )}

      <div className="history-toolbar">
        <input
          className="library-search history-search"
          type="search"
          value={filters.query}
          onChange={(event) =>
            setFilters((current) => ({ ...current, query: event.target.value }))
          }
          placeholder="搜索提示词关键词，如：江南 山水 夜景"
          aria-label="搜索生成历史"
        />
        <select
          className="library-sort"
          value={filters.timeRange}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              timeRange: event.target.value as HistoryFilters["timeRange"],
            }))
          }
          aria-label="时间筛选"
        >
          <option value="all">全部时间</option>
          <option value="today">今天</option>
          <option value="week">近 7 天</option>
          <option value="month">近 30 天</option>
        </select>
        <select
          className="library-sort"
          value={filters.model}
          onChange={(event) =>
            setFilters((current) => ({ ...current, model: event.target.value }))
          }
          aria-label="模型筛选"
        >
          <option value="">全部模型</option>
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <select
          className="library-sort"
          value={filters.aspectRatio}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              aspectRatio: event.target.value,
            }))
          }
          aria-label="比例筛选"
        >
          <option value="">全部比例</option>
          {ratioOptions.map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio}
            </option>
          ))}
        </select>
        <select
          className="library-sort history-filter-card"
          value={filters.promptCardId ?? ""}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              promptCardId:
                event.target.value === "" ? null : Number(event.target.value),
            }))
          }
          aria-label="提示词卡片筛选"
        >
          <option value="">全部提示词卡片</option>
          {promptCards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.title}
            </option>
          ))}
        </select>
        <select
          className="library-sort"
          value={filters.sort}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              sort: event.target.value as HistoryFilters["sort"],
            }))
          }
          aria-label="排序"
        >
          <option value="newest">最新生成</option>
          <option value="oldest">最早生成</option>
        </select>
      </div>

      <div className="history-layout">
        <div className="history-gallery">
          {displayItems.length === 0 ? (
            <p className="prompt-card-status">暂无生成历史</p>
          ) : visibleDisplayItems.length === 0 ? (
            <p className="prompt-card-status">没有符合条件的历史记录</p>
          ) : (
            <div className="history-grid">
              {visibleDisplayItems.map((entry) => {
                if (entry.status === "loading" || entry.status === "failed") {
                  return (
                    <article
                      key={entry.key}
                      className={`history-card history-card--${entry.status}`}
                    >
                      <div className="history-card-image-frame history-card-state-frame">
                        {entry.status === "loading" ? (
                          <>
                            <span
                              className="history-loading-spinner"
                              aria-hidden="true"
                            />
                            <span>生成中</span>
                          </>
                        ) : (
                          <>
                            <span
                              className="history-failed-icon"
                              aria-hidden="true"
                            >
                              !
                            </span>
                            <span>生成失败</span>
                          </>
                        )}
                      </div>
                      <div className="history-card-meta history-card-meta--static">
                        <span className="history-card-title">{entry.title}</span>
                        <span className="history-card-date">
                          {entry.status === "failed"
                            ? "请查看后台日志"
                            : formatHistoryDateTime(entry.createdAtMs / 1000)}
                        </span>
                      </div>
                    </article>
                  );
                }

                const history = entry.history;
                if (!history) {
                  return null;
                }

                const isSelected = history.id === selectedId;
                const title = entry.title || displayHistoryTitle(history);
                const failed = Boolean(failedImages[history.id]);
                return (
                  <article
                    key={entry.key}
                    className={
                      isSelected ? "history-card is-selected" : "history-card"
                    }
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className="history-card-image-hit"
                      onClick={() => selectHistoryItem(history.id)}
                      aria-label={`查看 ${title}`}
                    >
                      <div className="history-card-image-frame">
                        {failed ? (
                          <div className="history-card-image-placeholder">
                            图片不可用
                          </div>
                        ) : (
                          <img
                            className="history-card-image"
                            src={history.url}
                            alt=""
                            onError={() => markImageFailed(history.id)}
                          />
                        )}
                        {isSelected && (
                          <span
                            className="history-card-check"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="history-card-meta"
                      onClick={() => selectHistoryItem(history.id)}
                      aria-pressed={isSelected}
                      aria-label={`选择 ${title}`}
                    >
                      <span className="history-card-title">{title}</span>
                      <span className="history-card-date">
                        {formatHistoryDateTime(history.created_at)}
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {selectedItem ? (
          <aside className="history-detail" aria-label="历史详情">
            <div className="history-detail-header">
              <div className="history-detail-heading">
                <h2 className="history-detail-title">
                  {displayHistoryTitle(selectedItem)}
                </h2>
                <p className="history-detail-date">
                  {formatHistoryDateTime(selectedItem.created_at)}
                </p>
              </div>
              <div className="history-detail-nav">
                <button
                  type="button"
                  className="history-detail-nav-btn"
                  disabled={selectedIndex <= 0}
                  onClick={() => {
                    const prev = visibleCompletedItems[selectedIndex - 1];
                    if (prev) {
                      selectHistoryItem(prev.id);
                    }
                  }}
                  aria-label="上一条"
                >
                  ‹
                </button>
                <span className="history-detail-counter">
                  {selectedIndex + 1} / {visibleCompletedItems.length}
                </span>
                <button
                  type="button"
                  className="history-detail-nav-btn"
                  disabled={
                    selectedIndex >= visibleCompletedItems.length - 1
                  }
                  onClick={() => {
                    const next = visibleCompletedItems[selectedIndex + 1];
                    if (next) {
                      selectHistoryItem(next.id);
                    }
                  }}
                  aria-label="下一条"
                >
                  ›
                </button>
                <button
                  type="button"
                  className="history-detail-close"
                  onClick={() => {
                    setSelectedId(null);
                    setLightboxOpen(false);
                    setActionError(null);
                  }}
                  aria-label="关闭详情"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="history-detail-image-frame">
              <button
                type="button"
                className="history-detail-image-hit"
                aria-label="全屏预览"
                onClick={() => setLightboxOpen(true)}
              >
                {failedImages[selectedItem.id] ? (
                  <span className="history-detail-image-placeholder">
                    图片不可用
                  </span>
                ) : (
                  <img
                    className="history-detail-image"
                    src={selectedItem.url}
                    alt={displayHistoryTitle(selectedItem)}
                    onError={() => markImageFailed(selectedItem.id)}
                  />
                )}
              </button>
            </div>

            <dl className="history-detail-meta">
              <div>
                <dt>模型</dt>
                <dd>{selectedItem.model}</dd>
              </div>
              <div>
                <dt>比例</dt>
                <dd>{selectedItem.aspect_ratio}</dd>
              </div>
              <div>
                <dt>分辨率</dt>
                <dd>{selectedItem.resolution}</dd>
              </div>
            </dl>

            {actionError && (
              <p className="history-detail-error" role="alert">
                {actionError}
              </p>
            )}

            <div className="history-detail-actions">
              <button
                type="button"
                className="btn btn-primary history-download-btn"
                onClick={() => downloadHistoryImage(selectedItem)}
              >
                下载
              </button>
              <button
                type="button"
                className="btn btn-ghost history-delete-btn"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? "删除中…" : "删除"}
              </button>
            </div>
          </aside>
        ) : (
          <aside
            className="history-detail history-detail--empty"
            aria-label="历史详情"
          >
            <p className="history-detail-empty-hint">选择一张图片查看详情</p>
          </aside>
        )}
      </div>

      {lightboxOpen && selectedItem && (
        <ImageLightbox
          title={displayHistoryTitle(selectedItem)}
          currentIndex={selectedIndex + 1}
          total={visibleCompletedItems.length}
          imageUrl={
            failedImages[selectedItem.id] ? null : selectedItem.url
          }
          imageFailed={Boolean(failedImages[selectedItem.id])}
          onImageError={() => markImageFailed(selectedItem.id)}
          onClose={() => setLightboxOpen(false)}
          onDownload={() => downloadHistoryImage(selectedItem)}
          onPrev={() => {
            const prev = visibleCompletedItems[selectedIndex - 1];
            if (prev) {
              selectHistoryItem(prev.id);
            }
          }}
          onNext={() => {
            const next = visibleCompletedItems[selectedIndex + 1];
            if (next) {
              selectHistoryItem(next.id);
            }
          }}
        />
      )}
    </section>
  );
}
