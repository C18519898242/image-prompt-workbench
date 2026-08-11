import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { PromptCard } from "../api";

type PromptCardCardProps = {
  card: PromptCard;
  imageUrl: string | null;
  imageFailed: boolean;
  onImageError: () => void;
  onUsePrompt: () => void;
  onEdit: () => void;
  onDelete: () => void;
  actionsDisabled?: boolean;
  onPreview?: () => void;
};

export function PromptCardCard({
  card,
  imageUrl,
  imageFailed,
  onImageError,
  onUsePrompt,
  onEdit,
  onDelete,
  actionsDisabled = false,
  onPreview,
}: PromptCardCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const summary =
    card.prompt_text.length > 80
      ? `${card.prompt_text.slice(0, 80)}…`
      : card.prompt_text;

  useEffect(() => {
    if (!menuOpen) return;

    const closeAndRestoreFocus = () => {
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuContainerRef.current?.contains(event.target as Node)) {
        const clickedAnotherMenuTrigger =
          event.target instanceof Element &&
          event.target.closest(
            '.prompt-card-menu-trigger[aria-haspopup="menu"]',
          ) != null;
        if (clickedAnotherMenuTrigger) {
          setMenuOpen(false);
        } else {
          closeAndRestoreFocus();
        }
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    if (actionsDisabled) setMenuOpen(false);
  }, [actionsDisabled]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    action();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = 0;
    if (event.key === "End" || event.key === "ArrowUp" && currentIndex <= 0) {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex - 1;
    }
    items[nextIndex]?.focus();
  };

  return (
    <article className="prompt-card">
      <div
        className="prompt-card-image-frame prompt-card-image-frame--4x3"
        onClick={() => onPreview?.()}
        role={onPreview ? "button" : undefined}
        tabIndex={onPreview ? 0 : undefined}
        onKeyDown={
          onPreview
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPreview();
                }
              }
            : undefined
        }
        aria-label={onPreview ? `预览 ${card.title}` : undefined}
      >
        {imageUrl && !imageFailed ? (
          <img
            className="prompt-card-image"
            src={imageUrl}
            alt=""
            onError={onImageError}
          />
        ) : (
          <span className="prompt-card-image-placeholder">暂无图片</span>
        )}
        {card.image_count > 1 && (
          <span className="prompt-card-count">共 {card.image_count} 张</span>
        )}
      </div>
      <div className="prompt-card-body">
        <div className="prompt-card-heading-row">
          <h2 className="prompt-card-title">{card.title}</h2>
          <div ref={menuContainerRef} className="prompt-card-menu">
            <button
              ref={triggerRef}
              type="button"
              className="prompt-card-menu-trigger"
              aria-label={`${card.title}的更多操作`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={actionsDisabled}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                className="prompt-card-menu-popover"
                role="menu"
                onKeyDown={handleMenuKeyDown}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runMenuAction(onEdit)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runMenuAction(onDelete)}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        </div>
        {card.categories.length > 0 && (
          <ul className="prompt-card-tags">
            {card.categories.map((category) => (
              <li key={category.id}>{category.name}</li>
            ))}
          </ul>
        )}
        <p className="prompt-card-summary">{summary}</p>
        <button type="button" className="btn btn-primary" onClick={onUsePrompt}>
          使用此提示词
        </button>
      </div>
    </article>
  );
}
