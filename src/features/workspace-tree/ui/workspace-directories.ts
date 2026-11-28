export interface WorkspaceTransport {
  send(method: string, params: Record<string, unknown>, timeout?: number): Promise<any>;
  cancel(): void;
  close(): void;
}

export interface WorkspaceDirectoriesController {
  start(): void;
  expand(keys: string[]): void;
  close(): void;
}

interface DirRecord {
  key: string;
  entries: string[];
  loaded: boolean;
  busy: boolean;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | 0;
  watchId: string | null;
}

export function createWorkspaceTransport(onChanged?: (watchId: string) => void): WorkspaceTransport {
  const pending = new Map<string, (error: string | null, value?: any) => void>();
  let closed = false;

  function send(method: string, params: Record<string, unknown>, timeout = 3500): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `better-codex-tree:${crypto.randomUUID()}`;
      const finish = (error: string | null, value?: any) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        if (closed && pending.size === 0) window.removeEventListener('message', receive);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish('timeout'), timeout);
      pending.set(id, finish);
      window.addEventListener('message', receive);
      try {
        Promise.resolve(
          window.electronBridge?.sendMessageFromView({
            type: 'mcp-request',
            hostId: 'local',
            request: { id, method, params },
            timeoutMs: timeout,
          }),
        ).catch(() => finish('transport'));
      } catch {
        finish('transport');
      }
    });
  }

  function receive(event: MessageEvent): void {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (d?.hostId !== 'local') return;
    if (d.type === 'mcp-response') {
      const result = d.message;
      pending.get(result?.id)?.(result?.error ? 'rejected' : null, result?.result);
    } else if (!closed && d.type === 'mcp-notification' && d.method === 'fs/changed') {
      onChanged?.(d.params?.watchId);
    }
  }

  return {
    send,
    cancel() {
      for (const finish of pending.values()) finish('cancelled');
      this.close();
    },
    close() {
      closed = true;
      if (!pending.size) window.removeEventListener('message', receive);
    },
  };
}

// Read-only, per-panel App Server session. Request just the root and expanded
// directories. Project identity never changes which filesystem root is read.
export function createWorkspaceDirectories({
  root,
  isCurrent,
  onUpdate,
  onError,
}: {
  root: string;
  isCurrent: () => boolean;
  onUpdate: (removed: string[], added: string[], count: number) => void;
  onError: () => void;
}): WorkspaceDirectoriesController {
  const dirs = new Map<string, DirRecord>();
  const watches = new Map<string, DirRecord>();
  const maxDirs = 160;
  const maxPerDir = 10000;
  const maxPaths = 50000;
  let closed = false;
  let pathCount = 0;

  const active = () => !closed && isCurrent();
  const child = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

  const transport = createWorkspaceTransport((watchId) => {
    const dir = watches.get(watchId);
    if (dir && stillOpen(dir)) {
      dir.dirty = true;
      queueRead(dir);
    }
  });
  const { send } = transport;

  const stillOpen = (dir: DirRecord) => active() && dirs.get(dir.key) === dir;
  const absolute = (key: string) => (key ? `${root}\\${key.replaceAll('/', '\\')}` : root);

  function disposeWatch(dir: DirRecord): void {
    const watchId = dir.watchId;
    if (!watchId) return;
    dir.watchId = null;
    watches.delete(watchId);
    void send('fs/unwatch', { watchId }, 1400).catch(() => {});
  }

  function closeDir(dir: DirRecord): void {
    dirs.delete(dir.key);
    pathCount -= dir.entries.length;
    dir.entries = [];
    clearTimeout(dir.timer);
    dir.timer = 0;
    disposeWatch(dir);
  }

  function attachWatch(dir: DirRecord, path: string): void {
    if (dir.watchId) return;
    const watchId = `better-codex-tree:${crypto.randomUUID()}`;
    dir.watchId = watchId;
    watches.set(watchId, dir);
    void send('fs/watch', { watchId, path }).then(
      () => {
        if (!stillOpen(dir) || dir.watchId !== watchId) {
          void send('fs/unwatch', { watchId }, 1400).catch(() => {});
        }
      },
      () => {
        if (dir.watchId === watchId) disposeWatch(dir);
      },
    );
  }

  function setEntries(dir: DirRecord, next: string[], report = true): void {
    const before = dir.entries;
    if (dir.loaded && before.length === next.length && before.every((p, i) => p === next[i])) return;
    const old = new Set(before);
    const fresh = new Set(next);
    const removed = before.filter((p) => !fresh.has(p));
    const removedDirs = removed.filter((p) => p.endsWith('/'));
    for (const folder of removedDirs) {
      const top = dirs.get(folder.slice(0, -1));
      if (!top) continue;
      for (const [key, record] of dirs) {
        if (record === top || key.startsWith(folder)) closeDir(record);
      }
    }
    pathCount += next.length - before.length;
    dir.entries = next;
    if (report && (!dir.loaded || removed.length || next.length !== before.length)) {
      onUpdate(removed, next.filter((p) => !old.has(p)), pathCount);
    }
  }

  function queueRead(dir: DirRecord): void {
    if (dir.busy || dir.timer || !stillOpen(dir)) return;
    dir.timer = setTimeout(() => {
      dir.timer = 0;
      void read(dir);
    }, 100);
  }

  async function read(dir: DirRecord): Promise<void> {
    if (!stillOpen(dir) || dir.busy) return;
    dir.busy = true;
    dir.dirty = false;
    const path = absolute(dir.key);
    try {
      const meta = await send('fs/getMetadata', { path });
      if (!stillOpen(dir)) return;
      if (meta?.isDirectory !== true || meta.isSymlink !== false) throw 'not-directory';
      attachWatch(dir, path);
      const result = await send('fs/readDirectory', { path });
      if (!stillOpen(dir)) return;
      if (!Array.isArray(result?.entries)) throw 'unavailable';
      const limit = Math.min(maxPerDir, maxPaths - pathCount + dir.entries.length);
      const entries = new Map<string, boolean>();
      for (let i = 0; i < Math.min(result.entries.length, maxPerDir) && entries.size < limit; i++) {
        const row = result.entries[i];
        if (windowsName(row?.fileName)) entries.set(row.fileName, row.isDirectory === true);
      }
      setEntries(
        dir,
        Array.from(entries, ([name, folder]) => child(dir.key, name) + (folder ? '/' : '')),
      );
      dir.loaded = true;
    } catch {
      if (stillOpen(dir)) {
        disposeWatch(dir);
        setEntries(dir, [], Boolean(dir.key));
        dir.loaded = false;
        if (!dir.key) onError();
      }
    } finally {
      dir.busy = false;
      if (dir.dirty) queueRead(dir);
    }
  }

  function openDir(key: string): DirRecord | null {
    if (dirs.has(key)) return dirs.get(key)!;
    if (dirs.size >= maxDirs) return null;
    const dir: DirRecord = {
      key,
      entries: [],
      loaded: false,
      busy: false,
      dirty: false,
      timer: 0,
      watchId: null,
    };
    dirs.set(key, dir);
    void read(dir);
    return dir;
  }

  function start(): void {
    if (active()) openDir('');
  }

  function expand(keys: string[]): void {
    if (!active()) return;
    const wanted = new Set(['']);
    for (const key of keys) {
      if (!key || wanted.size >= maxDirs) continue;
      const slash = key.lastIndexOf('/');
      const parent = slash < 0 ? '' : key.slice(0, slash);
      if (wanted.has(parent) && dirs.get(parent)?.entries.includes(`${key}/`)) wanted.add(key);
    }
    const removed: string[] = [];
    for (const dir of dirs.values()) {
      if (wanted.has(dir.key)) continue;
      const parent = dir.key.slice(0, Math.max(0, dir.key.lastIndexOf('/')));
      if (wanted.has(parent)) removed.push(...dir.entries);
      closeDir(dir);
    }
    if (removed.length) onUpdate(removed, [], pathCount);
    for (const key of wanted) openDir(key);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    for (const dir of dirs.values()) closeDir(dir);
    dirs.clear();
    transport.close();
  }

  return { start, expand, close };
}
