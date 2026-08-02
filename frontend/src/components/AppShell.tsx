import { useState } from "react";

import type { PromptCard } from "../api";
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
  | { name: "workspace"; card: PromptCard };

type AppShellProps = {
  token: string;
};

export function AppShell({ token }: AppShellProps) {
  const [view, setView] = useState<AppView>({ name: "library" });
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(
    defaultLibraryFilters,
  );

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
                view.name === "library"
                  ? "app-shell-nav-btn is-active"
                  : "app-shell-nav-btn"
              }
              onClick={() => setView({ name: "library" })}
            >
              提示词库
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
            />
          )}
        </ViewErrorBoundary>
      </main>
    </div>
  );
}
