import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from "react";

import {
  ApiError,
  createPromptCard,
  updatePromptCard,
  type PromptCard,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import {
  appendUploadImages,
  buildPromptCardMutation,
  initialEditorImages,
  moveEditorImage,
  removeEditorImage,
  validateSelectedFiles,
  type EditorImage,
} from "../promptCardEditor";

export type PromptCardEditorDrawerProps = {
  token: string;
  mode: "create" | "edit";
  card: PromptCard | null;
  onClose: () => void;
  onSaved: (card: PromptCard) => void;
};

type FieldErrors = {
  title?: string;
  promptText?: string;
  images?: string;
};

const FOCUSABLE_SELECTOR = "button, input, textarea, [tabindex]";

function focusableDialogElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const disabled = "disabled" in element && Boolean(element.disabled);
      return !disabled
        && !element.hidden
        && element.getAttribute("aria-hidden") !== "true"
        && element.getAttribute("aria-disabled") !== "true"
        && element.tabIndex >= 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    });
}

function editorSnapshot(
  title: string,
  promptText: string,
  images: EditorImage[],
): string {
  return JSON.stringify({
    title,
    promptText,
    imageIds: images.map((image) => image.id),
  });
}

export function PromptCardEditorDrawer({
  token,
  mode,
  card,
  onClose,
  onSaved,
}: PromptCardEditorDrawerProps) {
  const initialTitle = mode === "edit" ? (card?.title ?? "") : "";
  const initialPromptText = mode === "edit" ? (card?.prompt_text ?? "") : "";
  const initialImages = initialEditorImages(mode === "edit" ? card : null);
  const [title, setTitle] = useState(initialTitle);
  const [promptText, setPromptText] = useState(initialPromptText);
  const [images, setImages] = useState<EditorImage[]>(initialImages);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const draggedIndexRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const uploadUrlsRef = useRef(new Set<string>());
  const initialSnapshotRef = useRef(
    editorSnapshot(initialTitle, initialPromptText, initialImages),
  );
  const { clearToken } = useAuth();

  const dirty = useMemo(
    () => editorSnapshot(title, promptText, images) !== initialSnapshotRef.current,
    [images, promptText, title],
  );

  const revokeUploadUrl = useCallback((previewUrl: string) => {
    if (uploadUrlsRef.current.delete(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
  }, []);

  const revokeAllUploadUrls = useCallback(() => {
    for (const previewUrl of uploadUrlsRef.current) {
      URL.revokeObjectURL(previewUrl);
    }
    uploadUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revokeAllUploadUrls();
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected) {
        restoreTarget.focus();
      }
    };
  }, [revokeAllUploadUrls]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("当前修改尚未保存，确定关闭吗？")) return;
    onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = focusableDialogElements(dialogRef.current);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const activeElement = document.activeElement;
      const activeIndex = focusableElements.indexOf(activeElement as HTMLElement);
      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }
      if (event.shiftKey) {
        if (activeIndex !== 0) return;
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (activeIndex !== focusableElements.length - 1) return;
      event.preventDefault();
      firstElement.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose();
    }
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length === 0) return;

    const error = validateSelectedFiles(files, images);
    if (error) {
      setSelectionError(error);
      event.currentTarget.value = "";
      return;
    }

    const nextImages = appendUploadImages(images, files);
    for (const image of nextImages.slice(images.length)) {
      if (image.kind === "upload") {
        uploadUrlsRef.current.add(image.previewUrl);
      }
    }
    setImages(nextImages);
    setSelectionError(null);
    setFieldErrors((current) => ({ ...current, images: undefined }));
    event.currentTarget.value = "";
  };

  const handleRemoveImage = (image: EditorImage) => {
    if (saving) return;
    if (image.kind === "upload") {
      revokeUploadUrl(image.previewUrl);
    }
    setImages((current) => removeEditorImage(current, image.id));
  };

  const handleMoveImage = (from: number, to: number) => {
    if (saving) return;
    setImages((current) => moveEditorImage(current, from, to));
  };

  const handleDragStart = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (saving) {
      event.preventDefault();
      return;
    }
    draggedIndexRef.current = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  };

  const handleDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (!saving) event.preventDefault();
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = draggedIndexRef.current;
    draggedIndexRef.current = null;
    if (saving || sourceIndex == null) return;
    setImages((current) => moveEditorImage(current, sourceIndex, targetIndex));
  };

  const validateForm = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!title.trim()) nextErrors.title = "请输入标题";
    if (!promptText.trim()) nextErrors.promptText = "请输入提示词";
    if (images.length === 0) nextErrors.images = "请至少上传一张示例图";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !validateForm()) return;

    if (mode === "edit" && !card) {
      setOperationError("未找到要编辑的提示词");
      return;
    }

    setSaving(true);
    setOperationError(null);
    const request = buildPromptCardMutation(title, promptText, images);

    try {
      const saved = mode === "create"
        ? await createPromptCard(token, request)
        : await updatePromptCard(token, card!.id, request);
      if (!mountedRef.current) return;
      revokeAllUploadUrls();
      onSaved(saved);
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        clearToken(token);
        if (!mountedRef.current) return;
      }
      setOperationError(
        error instanceof ApiError
          ? error.message
          : "保存提示词失败，请稍后重试",
      );
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  const heading = mode === "create" ? "新增提示词" : "编辑提示词";

  return (
    <div
      className="prompt-editor-backdrop"
      data-testid="prompt-editor-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <aside
        ref={dialogRef}
        className="prompt-editor-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-editor-heading"
        tabIndex={-1}
      >
        <header className="prompt-editor-header">
          <h2 id="prompt-editor-heading">{heading}</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={requestClose}
            disabled={saving}
          >
            关闭
          </button>
        </header>

        <form className="prompt-editor-form" onSubmit={handleSubmit} noValidate>
          <label className="prompt-editor-field">
            <span>标题</span>
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setFieldErrors((current) => ({ ...current, title: undefined }));
              }}
              disabled={saving}
            />
            {fieldErrors.title && (
              <span className="prompt-editor-field-error">{fieldErrors.title}</span>
            )}
          </label>

          <label className="prompt-editor-field">
            <span>提示词正文</span>
            <textarea
              value={promptText}
              onChange={(event) => {
                setPromptText(event.target.value);
                setFieldErrors((current) => ({ ...current, promptText: undefined }));
              }}
              disabled={saving}
            />
            {fieldErrors.promptText && (
              <span className="prompt-editor-field-error">
                {fieldErrors.promptText}
              </span>
            )}
          </label>

          <section className="prompt-editor-image-section" aria-labelledby="prompt-editor-images-heading">
            <div className="prompt-editor-image-heading">
              <h3 id="prompt-editor-images-heading">示例图</h3>
              <span>{images.length} / 20</span>
            </div>
            <label className="prompt-editor-upload btn btn-secondary">
              上传示例图
              <input
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                multiple
                onChange={handleFileSelection}
                disabled={saving}
              />
            </label>
            <p className="prompt-editor-upload-hint">
              支持 JPG、PNG，单张不超过 20 MB，最多 20 张。
            </p>
            {selectionError && (
              <p className="prompt-editor-field-error">{selectionError}</p>
            )}
            {fieldErrors.images && (
              <p className="prompt-editor-field-error">{fieldErrors.images}</p>
            )}

            {images.length > 0 && (
              <ol className="prompt-editor-images">
                {images.map((image, index) => (
                  <li
                    key={image.id}
                    className="prompt-editor-image-item"
                    draggable={!saving}
                    onDragStart={(event) => handleDragStart(event, index)}
                    onDragOver={handleDragOver}
                    onDrop={(event) => handleDrop(event, index)}
                    onDragEnd={() => {
                      draggedIndexRef.current = null;
                    }}
                  >
                    <img src={image.previewUrl} alt="" />
                    <span className="prompt-editor-image-name" title={image.name}>
                      {image.name}
                    </span>
                    <div className="prompt-editor-image-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`图片 ${index + 1} 前移`}
                        onClick={() => handleMoveImage(index, index - 1)}
                        disabled={saving || index === 0}
                      >
                        前移
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`图片 ${index + 1} 后移`}
                        onClick={() => handleMoveImage(index, index + 1)}
                        disabled={saving || index === images.length - 1}
                      >
                        后移
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost prompt-editor-image-remove"
                        aria-label={`图片 ${index + 1} 移除`}
                        onClick={() => handleRemoveImage(image)}
                        disabled={saving}
                      >
                        移除
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {operationError && (
            <p className="prompt-editor-operation-error" role="alert">
              {operationError}
            </p>
          )}

          <footer className="prompt-editor-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={requestClose}
              disabled={saving}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "保存中…" : "保存提示词"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
