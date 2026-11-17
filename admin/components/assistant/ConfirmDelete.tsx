/**
 * "Delete this chat?" confirmation, drawn over the chat window (not a browser
 * dialog). Esc or Cancel closes it; Delete runs onConfirm.
 */
import { useEffect } from 'react';
import { Button } from '@heroui/react';
import { TrashIcon } from './icons';

interface Props {
  title: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDelete({ title, busy = false, onCancel, onConfirm }: Props) {
  const open = title !== null;
  useEffect(() => {
    if (!open) return undefined;
    // Capture phase so the chat window's own Esc handling (collapse) does not also fire.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-transparent p-4 animate-[ta-teaser_.15s_ease]"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="ta-del-title" className="w-[min(360px,100%)] rounded-2xl border border-[#e7e7e9] bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,0.25)]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fde8e8] text-[#B30F09]"><TrashIcon className="h-5 w-5" /></div>
        <h3 id="ta-del-title" className="mt-3 text-[16px] font-semibold text-[#141414]">Delete this chat?</h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-[#6b6b65]">
          <span className="font-medium text-[#141414]">“{title || 'Untitled chat'}”</span> will be permanently deleted. This can’t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="bordered" radius="lg" className="h-9 border-[#d9d9d4] px-4 text-[13px]" isDisabled={busy} onPress={onCancel} autoFocus>Cancel</Button>
          <Button size="sm" color="danger" radius="lg" className="h-9 px-4 text-[13px] font-medium" isLoading={busy} onPress={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  );
}
