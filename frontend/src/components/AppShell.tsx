import { useState } from "react";

import { LogoutButton } from "./LogoutButton";
import {
  defaultLibraryFilters,
  PromptLibraryPage,
  type LibraryFilters,
} from "./PromptLibraryPage";
import { WorkspacePlaceholder } from "./WorkspacePlaceholder";

export type AppView =
  | { name: "library" }
  | { name: "workspace"; cardId: number | null }
  | { name: "history-placeholder" }
  | { name: "settings-placeholder" };

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
        <div className="app-shell-brand">
          <span className="app-shell-brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 3h6v2h1.5A2.5 2.5 0 0 1 19 7.5V9a5 5 0 0 1-2 4v3.5A2.5 2.5 0 0 1 14.5 19h-5A2.5 2.5 0 0 1 7 16.5V13a5 5 0 0 1-2-4V7.5A2.5 2.5 0 0 1 7.5 5H9V3Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Image Prompt Workbench</span>
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
          <button
            type="button"
            className={
              view.name === "workspace"
                ? "app-shell-nav-btn is-active"
                : "app-shell-nav-btn"
            }
            onClick={() => setView({ name: "workspace", cardId: null })}
          >
            生成工作台
          </button>
          <button
            type="button"
            className={
              view.name === "history-placeholder"
                ? "app-shell-nav-btn is-active"
                : "app-shell-nav-btn"
            }
            onClick={() => setView({ name: "history-placeholder" })}
          >
            历史
          </button>
        </nav>
        <div className="app-shell-actions">
          <LogoutButton />
        </div>
      </header>

      <main className="app-shell-main">
        {view.name === "library" && (
          <PromptLibraryPage
            token={token}
            filters={libraryFilters}
            onFiltersChange={setLibraryFilters}
            onUsePrompt={(cardId) => setView({ name: "workspace", cardId })}
          />
        )}
        {view.name === "workspace" && (
          <WorkspacePlaceholder
            cardId={view.cardId}
            onBack={() => setView({ name: "library" })}
          />
        )}
        {view.name === "history-placeholder" && (
          <section className="workspace-placeholder">
            <h1>生成历史</h1>
            <p>生成历史页即将推出。</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setView({ name: "library" })}
            >
              返回提示词库
            </button>
          </section>
        )}
        {view.name === "settings-placeholder" && (
          <section className="workspace-placeholder">
            <h1>设置</h1>
            <p>设置页即将推出。</p>
          </section>
        )}
      </main>
    </div>
  );
}
