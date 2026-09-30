import { create } from 'zustand';
import { db } from '../utils/db';
import { analyzeImport, commitImportSession, getConflictItems, parseBackupText, readCurrentRecords, resolutionKey } from '../utils/merge';
import type { ImportCommitCounts } from '../types/import';
import type { ImportEntityKind, ImportSession, ImportSide } from '../types/import';

const SESSION_ID = 'active-import';

interface ImportState {
  session?: ImportSession;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  stageBackup: (text: string, fileName: string) => Promise<string[]>;
  setResolution: (kind: Exclude<ImportEntityKind, 'sample'>, identity: string, side: ImportSide) => Promise<void>;
  refreshAnalysis: () => Promise<void>;
  discard: () => Promise<void>;
  commit: () => Promise<ImportCommitCounts>;
  unresolvedCount: () => number;
}

async function saveSession(session: ImportSession): Promise<void> {
  await db.importSessions.put(session);
}

export const useImportStore = create<ImportState>()((set, get) => ({
  hydrated: false,

  hydrate: async () => {
    const session = await db.importSessions.get(SESSION_ID);
    set({ session, hydrated: true });
  },

  stageBackup: async (text, fileName) => {
    if (get().session) {
      return ['已有待接收区，请先提交或放弃后再导入新的班组备份'];
    }
    const parsed = parseBackupText(text);
    if (!parsed.data) {
      return parsed.errors;
    }
    const current = await readCurrentRecords();
    const analysis = analyzeImport(current, parsed.data);
    if (analysis.errors.length) {
      return analysis.errors;
    }
    const session: ImportSession = {
      id: SESSION_ID,
      status: 'waiting',
      fileName,
      createdAt: new Date().toISOString(),
      ...(parsed.data.exportedAt ? { sourceExportedAt: parsed.data.exportedAt } : {}),
      data: parsed.data,
      resolutions: {},
      analysis,
    };
    await saveSession(session);
    set({ session });
    return [];
  },

  setResolution: async (kind, identity, side) => {
    const current = get().session;
    if (!current) return;
    const key = resolutionKey(kind, identity);
    const resolutions = { ...current.resolutions, [key]: side };
    const analysis = analyzeImport(await readCurrentRecords(), current.data, resolutions);
    const session = { ...current, resolutions, analysis };
    await saveSession(session);
    set({ session });
  },

  refreshAnalysis: async () => {
    const current = get().session;
    if (!current) return;
    const analysis = analyzeImport(await readCurrentRecords(), current.data, current.resolutions);
    const session = { ...current, analysis };
    await saveSession(session);
    set({ session });
  },

  discard: async () => {
    await db.importSessions.delete(SESSION_ID);
    set({ session: undefined });
  },

  commit: async () => {
    const current = get().session;
    if (!current) {
      throw new Error('待接收区为空');
    }
    const counts = await commitImportSession(current);
    set({ session: undefined });
    return counts;
  },

  unresolvedCount: () => {
    const session = get().session;
    return session ? getConflictItems(session.analysis).length : 0;
  },
}));
