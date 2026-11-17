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

  if (!setHostState) {
    if (typeof window === 'undefined') return Promise.resolve(false);
    return Promise.resolve(window.confirm(opts.message));
  }

  if (resolver) {
    try { resolver(false); } catch {}
    resolver = null;
  }

  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    setHostState!(opts);
  });
}

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
