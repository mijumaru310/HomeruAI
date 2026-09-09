"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native top layer escapes canvas clipping and keeps navigation outside scrolling content. */
export default function ModalLayer({ children, title, onClose }: {
  children: ReactNode;
  title: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="study-dialog" aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="study-dialog-nav">
        <strong>{title}</strong>
        <button type="button" autoFocus onClick={onClose}>← ノートに戻る</button>
      </header>
      <div className="study-dialog-scroll">{children}</div>
    </dialog>
  );
}
