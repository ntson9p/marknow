import Dexie, { type EntityTable } from 'dexie';

/** Continuous draft written ≤ 1 s after each change (FR-1.7, D15). */
export interface DraftRecord {
  docId: string;
  /** Full text (frontmatter included). */
  text: string;
  updatedAt: number;
  fileName: string | null;
  /** FSA handle — structured-cloneable in Chromium; absent elsewhere. */
  handle?: FileSystemFileHandle;
  /** Last saved full text, for the recovery diff preview. Null for never-saved docs. */
  baseText: string | null;
}

export interface RecentRecord {
  id: string;
  name: string;
  pathHint: string;
  lastOpenedAt: number;
  handle?: FileSystemFileHandle;
}

/** Version snapshot (FR-12). */
export interface SnapshotRecord {
  id?: number;
  docId: string;
  text: string;
  createdAt: number;
  trigger: 'save' | 'auto' | 'restore';
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class MarkNowDB extends Dexie {
  drafts!: EntityTable<DraftRecord, 'docId'>;
  recents!: EntityTable<RecentRecord, 'id'>;
  snapshots!: EntityTable<SnapshotRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor() {
    super('marknow');
    this.version(1).stores({
      drafts: 'docId, updatedAt',
      recents: 'id, lastOpenedAt',
      snapshots: '++id, docId, createdAt, [docId+createdAt]',
      settings: 'key',
    });
  }
}

export const db = new MarkNowDB();
