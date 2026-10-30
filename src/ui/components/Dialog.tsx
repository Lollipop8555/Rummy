import { useEffect, useRef, type ReactNode } from 'react';

export type DialogProps = {
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
  readonly onClose?: () => void;
  readonly closeOnBackdrop?: boolean;
};

/**
 * 模态对话框。
 *
 * 无障碍要点：
 * - 打开时把焦点移入对话框，避免焦点残留在被遮挡的牌桌上。
 * - `role="dialog"` + `aria-modal`，屏幕阅读器会隔离背景。
 * - Esc 关闭（仅在允许关闭时）。
 */
export function Dialog({
  title,
  children,
  actions,
  onClose,
  closeOnBackdrop = false,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const focusable = node.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, []);

  useEffect(() => {
    if (onClose === undefined) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      onClick={
        closeOnBackdrop && onClose !== undefined
          ? (event) => {
              if (event.target === event.currentTarget) {
                onClose();
              }
            }
          : undefined
      }
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <h2 className="dialog__title">{title}</h2>
        {children}
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
