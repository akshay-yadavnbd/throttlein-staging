/**
 * Promise-based confirmation dialog.
 * Usage:
 *   if (!(await confirmDialog('Delete this?'))) return;
 *   if (!(await confirmDialog({ title:'Cancel order', message:'…', destructive:true }))) return;
 *
 * The actual modal is rendered by <ConfirmProvider /> which must be mounted
 * once near the root of the React tree (see app/providers.tsx).
 */

export type ConfirmOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (value: boolean) => void;

let resolver: Resolver | null = null;
let setHostState: ((opts: ConfirmOpts | null) => void) | null = null;

export function confirmDialog(input: ConfirmOpts | string): Promise<boolean> {
  const opts: ConfirmOpts =
    typeof input === 'string' ? { message: input } : input;

  // If no host is registered, fall back to native confirm so behavior never breaks.
  if (!setHostState) {
    if (typeof window === 'undefined') return Promise.resolve(false);
    return Promise.resolve(window.confirm(opts.message));
  }

  // Reject any pending dialog before opening a new one
  if (resolver) {
    try {
      resolver(false);
    } catch {}
    resolver = null;
  }

  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    setHostState!(opts);
  });
}

/* ────── used internally by ConfirmProvider ────── */

export function __registerConfirmHost(setter: (opts: ConfirmOpts | null) => void) {
  setHostState = setter;
}

export function __resolveConfirm(value: boolean) {
  if (resolver) {
    const r = resolver;
    resolver = null;
    r(value);
  }
  setHostState?.(null);
}
