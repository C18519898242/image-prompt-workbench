import {
  defaultLibraryFilters,
  PromptLibraryPage,
  type LibraryFilters,
} from "./PromptLibraryPage";
import { useState } from "react";

/**
 * 兼容旧入口：内部转发到提示词库页。
 * 新代码请直接使用 PromptLibraryPage / AppShell。
 */
export function PromptCardBrowser({ token }: { token: string }) {
  const [filters, setFilters] = useState<LibraryFilters>(defaultLibraryFilters);
  return (
    <PromptLibraryPage
      token={token}
      filters={filters}
      onFiltersChange={setFilters}
      onUsePrompt={() => {
        /* 旧入口无工作台跳转 */
      }}
    />
  );
}
