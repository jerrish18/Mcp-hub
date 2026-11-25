import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, SlidersHorizontal } from 'lucide-react';

export function ChatActionGroup({
  children, placement, label,
}: {
  children: ReactNode;
  placement: 'toolbar' | 'composer' | 'reply';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isPopup = placement !== 'reply';
  const Icon = placement === 'toolbar' ? SlidersHorizontal : Ellipsis;

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (isPopup && !group.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !group.current?.contains(document.activeElement)) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open, isPopup]);

  return (
    <div ref={group} className={`chat-action-group chat-action-group--${placement}`} data-open={open}>
      <button ref={trigger} type="button" className="chat-action-trigger" aria-label={label}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Icon aria-hidden="true" className="size-[18px]" />
        {placement === 'reply' && <span>More</span>}
      </button>
      <div id={id} className="chat-action-items" onClick={placement === 'composer' ? (event) => {
        if ((event.target as Element).closest('button')) setOpen(false);
      } : undefined}>
        {children}
      </div>
    </div>
  );
}
