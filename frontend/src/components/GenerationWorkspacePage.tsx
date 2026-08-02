import type { PromptCard } from "../api";

export type GenerationWorkspacePageProps = {
  card: PromptCard;
  onBack: () => void;
};

export function GenerationWorkspacePage({
  card,
  onBack,
}: GenerationWorkspacePageProps) {
  return (
    <section className="generation-workspace">
      <button type="button" onClick={onBack}>
        返回提示词库
      </button>
      <h1>生成工作台</h1>
      <p>{card.title}</p>
      <textarea
        className="generation-prompt-editor"
        aria-label="提示词"
        value={card.prompt_text}
        readOnly
      />
    </section>
  );
}
