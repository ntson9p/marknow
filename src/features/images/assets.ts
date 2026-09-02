import { create } from 'zustand';

/**
 * Images-folder handle (FR-8.2/8.4). Held for the session; when set, pasted
 * images are written into an `assets/` subfolder and referenced with relative
 * links, and relative image paths resolve to blob URLs for display.
 */
interface AssetsState {
  dir: FileSystemDirectoryHandle | null;
  setDir: (dir: FileSystemDirectoryHandle | null) => void;
}

export const useAssetsStore = create<AssetsState>()((set) => ({
  dir: null,
  setDir: (dir) => set({ dir }),
}));

export function assetsSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface DirectoryPickerWindow {
  showDirectoryPicker: (opts?: {
    mode?: 'read' | 'readwrite';
    id?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

/** One-time folder grant (Chromium). Returns false if cancelled/unsupported. */
export async function requestAssetsFolder(): Promise<boolean> {
  if (!assetsSupported()) return false;
  try {
    const dir = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
      mode: 'readwrite',
      id: 'marknow-assets',
    });
    useAssetsStore.getState().setDir(dir);
    return true;
  } catch {
    return false;
  }
}

/** Write a blob into the `assets/` subfolder of the chosen directory (FR-8.2). */
export async function writeAsset(name: string, blob: Blob): Promise<void> {
  const dir = useAssetsStore.getState().dir;
  if (!dir) throw new Error('No images folder selected');
  const assets = await dir.getDirectoryHandle('assets', { create: true });
  const fileHandle = await assets.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

const blobUrlCache = new Map<string, string>();

/** Resolve a relative `assets/…` path to a blob URL, or null when unavailable (FR-8.4). */
export async function resolveRelativeAsset(path: string): Promise<string | null> {
  const dir = useAssetsStore.getState().dir;
  // Only relative paths need resolving; data:/http(s):/absolute pass through.
  if (!dir || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/')) return null;
  if (blobUrlCache.has(path)) return blobUrlCache.get(path)!;

  const parts = path.split('/').filter((p) => p && p !== '.');
  try {
    let d = dir;
    for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
    const fh = await d.getFileHandle(parts[parts.length - 1]);
    const url = URL.createObjectURL(await fh.getFile());
    blobUrlCache.set(path, url);
    return url;
  } catch {
    return null;
  }
}
