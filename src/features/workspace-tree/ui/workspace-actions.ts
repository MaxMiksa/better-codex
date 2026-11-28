export type WorkspaceActionKind = 'folder' | 'open' | 'locate' | 'preview' | 'dismissPreview';

interface PendingAction<C, V> {
  id: string;
  kind: WorkspaceActionKind;
  context: C & { root: string };
  view: V | null;
  relative: string;
  dismiss: string | null;
  expires: number;
  pulled: boolean;
  dismissible?: boolean;
  closed?: boolean;
  nativeOpen?: ((path: string) => Promise<{ success?: boolean }>) | null;
}

// Reuse the initialized AppHost. A second AppHost port registers a new AppView
// for this window and can disrupt the original renderer.
async function findNativeFolderOpen(): Promise<((path: string) => Promise<{ success?: boolean }>) | null> {
  const services = new Set<any>();
  for (const script of document.scripts) {
    if (script.type !== 'module' || !script.src) continue;
    const url = new URL(script.src);
    if (url.origin !== location.origin || !/^\/assets\/[^/]+\.js$/.test(url.pathname)) continue;
    try {
      const loader = (await import(url.href)).__webpack_require__;
      for (const mod of Object.values<any>(loader?.c ?? {})) {
        const api = mod?.exports;
        if (
          api &&
          Object.hasOwn(api, 'appServices') &&
          Object.hasOwn(api, 'setAppServices') &&
          Object.hasOwn(api, 'setAppHost') &&
          typeof api.appServices?.openIn?.open === 'function'
        ) {
          services.add(api);
        }
      }
    } catch {
      // The existing Windows route covers unsupported app builds.
    }
  }
  if (services.size !== 1) return null;
  const [api] = services;
  return (path: string) =>
    api.appServices.openIn.open({ cwd: null, hostId: 'local', path, target: 'fileManager' });
}

// Only real gestures on the current local tree can enqueue a native action.
export function createWorkspaceActions<C extends { root: string | null }, V>({
  contextIsCurrent,
  fileIsCurrent,
  fileIsFocused,
  notice,
}: {
  contextIsCurrent: (context: C) => boolean;
  fileIsCurrent: (view: V, path: string) => boolean;
  fileIsFocused: (view: V, path: string) => boolean;
  notice: (status: string) => void;
}) {
  let request: PendingAction<C, V> | null = null;
  let latest: string | null = null;
  let preview: PendingAction<C, V> | null = null;
  let nativeFolderOpen: ((path: string) => Promise<{ success?: boolean }>) | null = null;

  const belongs = (action: PendingAction<C, V>) =>
    contextIsCurrent(action.context) && (!action.view || fileIsCurrent(action.view, action.relative));

  const canStart = (action: PendingAction<C, V> | null): action is PendingAction<C, V> =>
    Boolean(
      action &&
        Date.now() < action.expires &&
        document.hasFocus() &&
        belongs(action) &&
        (action.kind !== 'preview' || (action.view && fileIsFocused(action.view, action.relative))),
    );

  const canDismiss = (context: C | null, view: V | null, relative: string) =>
    Boolean(
      preview?.dismissible &&
        preview.context === context &&
        preview.view === view &&
        preview.relative === relative &&
        belongs(preview),
    );

  async function start(
    event: Event,
    kind: WorkspaceActionKind,
    context: C | null,
    view: V | null = null,
    relative = '',
  ): Promise<void> {
    if (!event.isTrusted || !context?.root) return;
    const dismiss =
      (kind === 'preview' || kind === 'dismissPreview') && canDismiss(context, view, relative)
        ? preview!.id
        : null;
    if (kind === 'dismissPreview' && !dismiss) return;

    const action: PendingAction<C, V> = {
      id: crypto.randomUUID(),
      kind,
      context: context as C & { root: string },
      view,
      relative,
      dismiss,
      expires: Date.now() + 3000,
      pulled: false,
    };
    if (!canStart(action)) return;
    request = action;
    latest = action.id;
    if (kind !== 'preview' && kind !== 'dismissPreview') preview = null;
    if (kind === 'folder') {
      action.nativeOpen = nativeFolderOpen ??= await findNativeFolderOpen();
      if (request !== action || !canStart(action)) return;
    }
    try {
      window.__betterCodexWorkspaceAction?.(action.id);
    } catch {
      result(action.id, 'actionFailed');
    }
  }

  function pull(id: string): Record<string, unknown> | null {
    if (request?.id !== id || request.pulled || !canStart(request)) return null;
    request.pulled = true;
    return {
      kind: request.kind,
      root: request.context.root,
      relative: request.relative,
      nativeFolder: typeof request.nativeOpen === 'function',
      ...(request.dismiss ? { dismiss: request.dismiss } : {}),
    };
  }

  function result(id: string, status: string): void {
    if (status === 'nativePreviewClosed') {
      if (preview?.id === id) preview = null;
      if (request?.id === id) request.closed = true;
      return;
    }
    if (request?.id !== id) return;
    const last = request;
    request = null;

    if (last.kind === 'preview' && last.pulled) {
      if (status === 'nativePreviewReady' || status === 'nativePreviewDismissible') {
        last.dismissible = status === 'nativePreviewDismissible';
        if (!last.closed) preview = last;
      } else if (status !== 'nativePreviewBlocked' && status !== 'nativePreviewDismissed') {
        preview = null;
      }
    }

    if (
      status === 'openNativeFolder' &&
      last.kind === 'folder' &&
      last.pulled &&
      last.nativeOpen &&
      canStart(last)
    ) {
      void (async () => {
        try {
          if ((await last.nativeOpen!(last.context.root))?.success === true) return;
        } catch {
          // Fall through to notice if still current.
        }
        if (latest === id && belongs(last)) notice('actionFailed');
      })();
      return;
    }

    if (
      ['previewUnavailable', 'locateOnly', 'actionFailed', 'folderBackground'].includes(status) &&
      belongs(last)
    ) {
      notice(status);
    }
  }

  function confirmPreview(id: string): boolean {
    const action = preview?.id === id ? preview : request;
    return Boolean(action && action.id === id && action.kind === 'preview' && action.pulled && belongs(action));
  }

  return {
    start,
    pull,
    result,
    canDismiss,
    confirm: (id: string) => Boolean(request?.id === id && request.pulled && canStart(request)),
    confirmPreview,
    reset() {
      request = latest = preview = null;
    },
  };
}
