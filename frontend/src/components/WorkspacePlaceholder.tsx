type WorkspacePlaceholderProps = {
  cardId: number | null;
  onBack: () => void;
};

export function WorkspacePlaceholder({
  cardId,
  onBack,
}: WorkspacePlaceholderProps) {
  return (
    <section className="workspace-placeholder">
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        返回提示词库
      </button>
      <h1>生成工作台</h1>
      <p>生成工作台即将推出。本页仅作为「使用此提示词」跳转占位。</p>
      {cardId != null && <p>已选择提示词卡片 ID：{cardId}</p>}
    </section>
  );
}
