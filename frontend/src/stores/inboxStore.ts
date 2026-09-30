import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import {
  batchKey,
  buildInboxDoc,
  countInbox,
  herbKey,
  methodKey,
  observeLogKey,
  parseBackup,
} from '../utils/merge';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';
import type { InboxCounters, InboxDoc, InboxEntityEntry, InboxMaster, InboxSampleEntry } from '../types/inbox';

const INBOX_ID = 'current';

interface InboxState {
  doc: InboxDoc | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /**
   * 读入班组备份：只解析、校验并写入待接收区，不触碰四张正式台账。
   * 任何一步失败都抛错，既有接收区原样保留（成功写入才会替换）。
   */
  importToInbox: (text: string) => Promise<InboxCounters>;
  /** 质检员为冲突条目选定主记录 */
  resolve: (kind: 'herbs' | 'methods' | 'batches', key: string, master: InboxMaster) => Promise<void>;
  /** 放弃接收区（正式台账从未被导入过程修改，无需回滚） */
  discard: () => Promise<void>;
  /**
   * 把已裁决的接收区合入正式台账：单事务、按 药材→方法→工序→留样 顺序写入，
   * 任一步失败整体回滚且接收区保留；成功后才清空接收区。
   */
  commit: () => Promise<InboxCounters>;
}

export const useInboxStore = create<InboxState>()((set, get) => ({
  doc: null,
  hydrated: false,

  hydrate: async () => {
    const doc = await db.inbox.get(INBOX_ID);
    set({ doc: doc ?? null, hydrated: true });
  },

  importToInbox: async (text) => {
    // 接收区尚有未合入内容时拒绝覆盖：先完成接收或放弃，避免待裁决记录丢失。
    const existed = await db.inbox.get(INBOX_ID);
    if (existed) {
      throw new Error('待接收区还有未合入的班组记录，请先在「待接收区」完成接收或放弃后再导入');
    }
    // 先在内存中完成全部解析与校验；parseBackup 抛错则什么都不写。
    const [herbs, methods, batches, samples] = await Promise.all([
      db.herbs.toArray(),
      db.methods.toArray(),
      db.batches.toArray(),
      db.samples.toArray(),
    ]);
    const backup = parseBackup(text, { herbs, methods, batches, samples });
    const doc = buildInboxDoc(backup, { herbs, methods, batches, samples });

    // 仅写 inbox 一张表：事务失败时旧接收区保持原样，正式台账全程不参与。
    await db.transaction('rw', db.inbox, async () => {
      await db.inbox.put(doc);
    });
    set({ doc });
    return countInbox(doc);
  },

  resolve: async (kind, key, master) => {
    const current = get().doc;
    if (!current) {
      return;
    }
    const entries = current[kind].map((entry) => (entry.key === key && entry.status === 'conflict' ? { ...entry, resolution: master } : entry));
    const next = { ...current, [kind]: entries };
    await db.inbox.put(next);
    set({ doc: next });
  },

  discard: async () => {
    await db.inbox.delete(INBOX_ID);
    set({ doc: null });
  },

  commit: async () => {
    const doc = get().doc;
    if (!doc) {
      throw new Error('接收区为空，没有可合入的班组记录');
    }
    const counters = countInbox(doc);

    await db.transaction('rw', db.herbs, db.methods, db.batches, db.samples, db.inbox, async () => {
      /*
       * 事务内重新读取正式台账，防止导入后、接收前本机数据被改动导致错配。
       * 校验不过直接抛错 → Dexie 回滚全部写入，接收区保留，不会露出半套数据。
       */
      const [currentHerbs, currentMethods, currentBatches, currentSamples] = await Promise.all([
        txIndex<HerbMaterial>(db.herbs, (h) => herbKey(h.name, h.batchNo)),
        txIndex<ProcessingMethod>(db.methods, (m) => methodKey(m.name, m.auxiliary)),
        txIndex<ProcessBatch>(db.batches, (b) => batchKey(b.batchNo)),
        db.samples.toArray(),
      ]);

      const assertLocalUnchanged = <T extends { id: string }>(
        entries: Array<InboxEntityEntry<T>>,
        index: Map<string, T>,
        label: string,
      ) => {
        entries.forEach((entry) => {
          if (!entry.local) {
            return;
          }
          const now = index.get(entry.key);
          if (!now || now.id !== entry.local.id) {
            throw new Error(`本机${label}台账在接收前已发生变化（${entry.key}），合入已中止，接收区保留，请重新导入`);
          }
        });
      };
      assertLocalUnchanged(doc.herbs, currentHerbs, '药材');
      assertLocalUnchanged(doc.methods, currentMethods, '炮制方法');
      assertLocalUnchanged(doc.batches, currentBatches, '工序');

      // 1) 药材：冲突按裁决把主记录写到本机 id（本机引用不断）；新增补入，id 撞车则换新 id。
      const herbIdMap = await mergeEntities({
        table: db.herbs,
        entries: doc.herbs,
        index: currentHerbs,
      });

      // 2) 炮制方法
      const methodIdMap = await mergeEntities({
        table: db.methods,
        entries: doc.methods,
        index: currentMethods,
      });

      // 3) 工序：主记录的药材/方法引用重映射到合入后的 id，保证先有药材与方法才有工序。
      const batchIdMap = await mergeEntities({
        table: db.batches,
        entries: doc.batches,
        index: currentBatches,
        rewrite: (batch) => ({
          ...batch,
          herbId: mapOrThrow(herbIdMap, batch.herbId, '药材'),
          methodId: mapOrThrow(methodIdMap, batch.methodId, '炮制方法'),
        }),
      });

      // 4) 留样：本机留样只追加观察记录；新增留样必须挂到合入后存在的工序上。
      await mergeSamples(doc.samples, currentSamples, batchIdMap);

      // 全部写入成功后才清掉接收区；本步随事务，失败则接收区一并回滚保留。
      await db.inbox.delete(INBOX_ID);
    });

    set({ doc: null });
    return counters;
  },
}));

async function txIndex<T>(table: { toArray(): Promise<T[]> }, keyOf: (row: T) => string): Promise<Map<string, T>> {
  const rows = await table.toArray();
  return new Map(rows.map((row) => [keyOf(row), row]));
}

function mapOrThrow(map: Map<string, string>, fromId: string, label: string): string {
  const to = map.get(fromId);
  if (!to) {
    throw new Error(`合入时找不到${label}映射（${fromId}），事务已回滚，接收区保留`);
  }
  return to;
}

interface MergeEntitiesOptions<T extends { id: string }> {
  table: { get: (id: string) => Promise<T | undefined>; bulkPut: (rows: T[]) => Promise<unknown> };
  entries: Array<InboxEntityEntry<T>>;
  index: Map<string, T>;
  /** 写入前对入选记录做外键重写（工序需要） */
  rewrite?: (row: T) => T;
}

/**
 * 合入单张实体表，返回 备份原始 id → 合入后最终 id 的映射，供下游工序/留样重挂引用。
 * 不删除任何本机记录：
 * - identical / 冲突本机为主：本机记录不动；
 * - 冲突班组为主：以班组记录内容覆盖到“本机 id”上（本机留样等引用不断链）；
 * - add：补入；若备份 id 与本机无关记录撞车，则分配新 id。
 */
async function mergeEntities<T extends { id: string }>(options: MergeEntitiesOptions<T>): Promise<Map<string, string>> {
  const { table, entries, index, rewrite = (row: T) => row } = options;
  const idMap = new Map<string, string>();
  const toPut: T[] = [];

  // 预置本机全部记录的自身映射：工序可引用未在接收区出现的本机原有药材/方法。
  for (const localRow of index.values()) {
    idMap.set(localRow.id, localRow.id);
  }

  for (const entry of entries) {
    const local = entry.local ?? index.get(entry.key);
    const incoming = entry.incoming;

    if (entry.status === 'add' || !local) {
      const row = incoming!;
      let finalId = row.id;
      const collided = await table.get(row.id);
      if (collided) {
        finalId = uid(row.id.split('-')[0] ?? 'row');
      }
      toPut.push({ ...rewrite(row), id: finalId });
      idMap.set(row.id, finalId);
      continue;
    }

    // 同一条身份：本机 id 与备份 id 都指向合入后的本机记录。
    idMap.set(local.id, local.id);
    if (incoming) {
      idMap.set(incoming.id, local.id);
    }
    if (entry.status === 'conflict' && (entry.resolution ?? 'local') === 'incoming' && incoming) {
      toPut.push({ ...rewrite(incoming), id: local.id });
    }
  }

  if (toPut.length > 0) {
    await table.bulkPut(toPut);
  }
  return idMap;
}

/** 留样合入：本机留样头信息永不覆盖，只追加去重后的观察记录；新留样挂到合入后的工序 */
async function mergeSamples(
  entries: InboxSampleEntry[],
  currentSamples: RetainSample[],
  batchIdMap: Map<string, string>,
): Promise<void> {
  const byId = new Map(currentSamples.map((s) => [s.id, s]));
  const toPut: RetainSample[] = [];

  for (const entry of entries) {
    // 以事务内最新的本机留样为准追加，避免覆盖接收期间新补的观察记录。
    const local = entry.local ? byId.get(entry.local.id) ?? entry.local : undefined;
    const incoming = entry.incoming;

    if (entry.status === 'merge' && local && incoming) {
      const existed = new Set((local.observeLogs ?? []).map(observeLogKey));
      const fresh = (incoming.observeLogs ?? []).filter((log) => !existed.has(observeLogKey(log)));
      if (fresh.length > 0) {
        toPut.push({
          ...local,
          observeLogs: [...(local.observeLogs ?? []), ...fresh].sort((a, b) => a.date.localeCompare(b.date)),
        });
      }
      continue;
    }

    if (entry.status === 'add' && incoming) {
      const batchId = mapOrThrow(batchIdMap, incoming.batchId, '工序');
      let finalId = incoming.id;
      if (byId.has(incoming.id)) {
        finalId = uid('sample');
      }
      toPut.push({ ...incoming, id: finalId, batchId });
    }
  }

  if (toPut.length > 0) {
    await db.samples.bulkPut(toPut);
  }
}
