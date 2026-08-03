import { useRef, useState } from "react";

import { ApiError, generateImage, type PromptCard } from "../api";
import { useAuth } from "../auth/AuthContext";
import type { GenerationSubmission, SessionGenerationCard } from "../generation";
import { GenerationHistoryPage } from "./GenerationHistoryPage";
import { GenerationWorkspacePage } from "./GenerationWorkspacePage";
import { LogoutButton } from "./LogoutButton";
import {
  defaultLibraryFilters,
  PromptLibraryPage,
  type LibraryFilters,
} from "./PromptLibraryPage";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

export type AppView =
  | { name: "library" }
  | { name: "workspace"; card: PromptCard }
  | { name: "history"; promptCardId: number | null };

type AppShellProps = {
  token: string;
};

export function AppShell({ token }: AppShellProps) {
  const [view, setView] = useState<AppView>({ name: "library" });
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(
    defaultLibraryFilters,
  );
  const activeBatchIdRef = useRef(0);
  const [sessionCards, setSessionCards] = useState<SessionGenerationCard[]>([]);
  const { clearToken } = useAuth();

  const runBatch = async (
    batchId: number,
    submission: GenerationSubmission,
  ) => {
    for (let sequence = 0; sequence < submission.quantity; sequence += 1) {
      if (activeBatchIdRef.current !== batchId) {
        return;
      }
      const loadingCard: SessionGenerationCard = {
        clientId: crypto.randomUUID(),
        batchId,
        status: "loading",
        promptCardId: submission.card.id,
        title: submission.card.title,
        model: submission.model,
        aspectRatio: submission.aspectRatio,
        resolution: submission.resolution,
        createdAtMs: Date.now(),
        sequence,
      };
      setSessionCards((current) => [loadingCard, ...current]);
      try {
        const history = await generateImage(token, {
          prompt_card_id: submission.card.id,
          prompt: submission.prompt,
          model: submission.model,
          aspect_ratio: submission.aspectRatio,
          resolution: submission.resolution,
          thinking_level: submission.thinkingLevel,
          reference_images: submission.referenceImages,
        });
        setSessionCards((current) => {
          const completed: SessionGenerationCard = {
            ...loadingCard,
            status: "completed",
            createdAtMs: Date.now(),
            history,
          };
          return current.some((item) => item.clientId === loadingCard.clientId)
            ? current.map((item) =>
                item.clientId === loadingCard.clientId ? completed : item,
              )
            : [completed, ...current];
        });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) {
          clearToken(token);
          return;
        }
        setSessionCards((current) =>
          current.map((item) =>
            item.clientId === loadingCard.clientId
              ? { ...item, status: "failed" }
              : item,
          ),
        );
      }
      if (activeBatchIdRef.current !== batchId) {
        return;
      }
    }
  };

  const startGeneration = (submission: GenerationSubmission) => {
    const batchId = activeBatchIdRef.current + 1;
    activeBatchIdRef.current = batchId;
    setSessionCards((current) =>
      current.filter((item) => item.status !== "loading"),
    );
    setView({ name: "history", promptCardId: submission.card.id });
    void runBatch(batchId, submission);
  };

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-header-left">
          <div className="app-shell-brand" aria-hidden="true">
            <span className="app-shell-brand-mark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 3h6v2h1.5A2.5 2.5 0 0 1 19 7.5V9a5 5 0 0 1-2 4v3.5A2.5 2.5 0 0 1 14.5 19h-5A2.5 2.5 0 0 1 7 16.5V13a5 5 0 0 1-2-4V7.5A2.5 2.5 0 0 1 7.5 5H9V3Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          <nav className="app-shell-nav" aria-label="主导航">
            <button
              type="button"
              className={
                view.name === "library" || view.name === "workspace"
                  ? "app-shell-nav-btn is-active"
                  : "app-shell-nav-btn"
              }
              onClick={() => setView({ name: "library" })}
            >
              提示词库
            </button>
            <button
              type="button"
              className={
                view.name === "history"
                  ? "app-shell-nav-btn is-active"
                  : "app-shell-nav-btn"
              }
              onClick={() => setView({ name: "history", promptCardId: null })}
            >
              历史
            </button>
          </nav>
        </div>
        <div className="app-shell-actions">
          <LogoutButton />
        </div>
      </header>

      <main className="app-shell-main">
        <ViewErrorBoundary
          onReset={() => setView({ name: "library" })}
        >
          {view.name === "library" && (
            <PromptLibraryPage
              token={token}
              filters={libraryFilters}
              onFiltersChange={setLibraryFilters}
              onUsePrompt={(card) => {
                if (!card || typeof card !== "object") {
                  console.error("onUsePrompt 收到无效卡片", card);
                  return;
                }
                setView({ name: "workspace", card });
              }}
            />
          )}
          {view.name === "workspace" && view.card && (
            <GenerationWorkspacePage
              card={view.card}
              onBack={() => setView({ name: "library" })}
              onGenerate={startGeneration}
            />
          )}
          {view.name === "history" && (
            <GenerationHistoryPage
              token={token}
              initialPromptCardId={view.promptCardId}
              sessionCards={sessionCards}
            />
          )}
        </ViewErrorBoundary>
      </main>
    </div>
  );
}
