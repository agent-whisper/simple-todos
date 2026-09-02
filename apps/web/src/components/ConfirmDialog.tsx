import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  /** Names the thing at stake; becomes the dialog's accessible name. */
  heading: string;
  /** What will happen. Say the irreversible part plainly. */
  body: string;
  /** The verb, not "OK" — the button should say what it does. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A confirmation the app can style, rather than window.confirm.
 *
 * Native confirm cannot carry the detail that matters here — how much goes with
 * the thing you are deleting — and drops the reader out of the app's own voice
 * into a browser chrome box.
 */
export function ConfirmDialog({
  heading,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="confirm-heading" onClose={onCancel}>
      <div className="dialog__form">
        <h2 id="confirm-heading" className="dialog__heading">
          {heading}
        </h2>
        <p className="confirm__body">{body}</p>
        <div className="dialog__actions">
          {/* Cancel first and focused: the safe choice should be the easy one. */}
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="dialog__submit dialog__submit--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
