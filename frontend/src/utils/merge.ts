import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ObserveLog, RetainSample } from '../types/retain-sample';
import type { ProcessBatch } from '../types/process-batch';
import type { InboxCounters, InboxDoc, InboxEntityEntry, InboxSampleEntry } from '../types/inbox';
import type { BackupPayload } from './export';

/* ------------------------------------------------------------------ */
/* 身份键：按现有记录的自然字段判定“同一条”，不依赖各机自分配的 id      */
/* ------------------------------------------------------------------ */

/** 药材身份：药材名 + 批次号（同名药材不同批号是两批投料） */
export function herbKey(name: string, batchNo: string): string {
  return `${normText(name)}｜${normCode(batchNo)}`;
}

/** 炮制方法身份：方法名 + 辅料（同名不同辅料的派生方法是不同方法） */
export function methodKey(name: string, auxiliary: string): string {
  return `${normText(name)}｜${normText(auxiliary)}`;
}

/** 工序身份：生产批号 */
export function batchKey(batchNo: string): string {
  return normCode(batchNo);
}

/** 留样身份：留样编号 */
export function sampleKey(sampleNo: string): string {
  return normCode(sampleNo);
}

function normText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** 批号/编号：去空白后拉丁字母与数字大写，消除两台机器录入大小写差异 */
function normCode(value: unknown): string {
  return normText(value).toUpperCase();
}

/* ------------------------------------------------------------------ */
/* 备份解析与校验：任一条不合法则整份拒收，不产生任何台账写入           */
/* ------------------------------------------------------------------ */

const HERB_FIELDS: Array<keyof HerbMaterial> = ['id', 'name', 'origin', 'part', 'batchNo', 'feedKg', 'receivedAt'];
const METHOD_FIELDS: Array<keyof ProcessingMethod> = ['id', 'name', 'auxiliary', 'auxRatio', 'fireLevel', 'tempRange', 'duration', 'criterion', 'criterionDimension'];
const BATCH_FIELDS: Array<keyof ProcessBatch> = ['id', 'batchNo', 'herbId', 'methodId', 'feedKg', 'auxUsedKg', 'fireLevel', 'startedAt', 'endedAt', 'yieldRate', 'degree', 'operator', 'locked'];
const SAMPLE_FIELDS: Array<keyof RetainSample> = ['id', 'sampleNo', 'batchId', 'amountG', 'retainMonths', 'cabinet', 'retainedAt', 'observeLogs'];

export interface ParsedBackup {
  exportedAt?: string;
  machineId?: string;
  machineName?: string;
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

function requireFields(row: Record<string, unknown>, fields: string[], label: string, index: number): void {
  const missing = fields.filter((f) => row[f] === undefined || row[f] === null || row[f] === '');
  if (missing.length > 0) {
    throw new Error(`备份中第 ${index + 1} 条${label}缺少字段：${missing.join('、')}，整份备份已拒收`);
  }
}

function assertUniqueIds(rows: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.id)) {
      throw new Error(`备份中${label} id 重复（${row.id}，第 ${index + 1} 条），无法可靠合入，整份备份已拒收`);
    }
    seen.add(row.id);
  });
}

function assertUniqueNatural<T>(rows: T[], keyOf: (row: T) => string, label: string): void {
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    const prev = seen.get(key);
    if (prev !== undefined) {
      throw new Error(`备份中${label}身份重复（第 ${prev + 1} 条与第 ${index + 1} 条），请先在班组机上合并后再导出`);
    }
    seen.set(key, index);
  });
}

/**
 * 解析并校验班组备份文本；失败抛错，由调用方保留既有接收区并提示。
 * 工序/留样允许引用本机台账已有的药材、方法与工序（班组记录可能挂在本机原有药材上），
 * 但备份内与本机两边都找不到的引用一律拒收——先有药材与方法才有工序，先有工序才有留样。
 */
export function parseBackup(text: string, local: LocalSnapshot = { herbs: [], methods: [], batches: [], samples: [] }): ParsedBackup {
  let payload: Partial<BackupPayload>;
  try {
    payload = JSON.parse(text) as Partial<BackupPayload>;
  } catch {
    throw new Error('备份文件不是合法 JSON，整份备份已拒收');
  }
  if (!payload || payload.app !== 'gbherbprocess') {
    throw new Error('备份文件格式不匹配（缺少 app=gbherbprocess 标记），整份备份已拒收');
  }

  const herbs = (payload.herbs ?? []) as HerbMaterial[];
  const methods = (payload.methods ?? []) as ProcessingMethod[];
  const batches = (payload.batches ?? []) as ProcessBatch[];
  const samples = (payload.samples ?? []) as RetainSample[];

  herbs.forEach((h, i) => requireFields(h as unknown as Record<string, unknown>, HERB_FIELDS as string[], '药材', i));
  methods.forEach((m, i) => requireFields(m as unknown as Record<string, unknown>, METHOD_FIELDS as string[], '炮制方法', i));
  batches.forEach((b, i) => requireFields(b as unknown as Record<string, unknown>, BATCH_FIELDS as string[], '工序', i));
  samples.forEach((s, i) => {
    requireFields(s as unknown as Record<string, unknown>, SAMPLE_FIELDS as string[], '留样', i);
    if (!Array.isArray(s.observeLogs)) {
      throw new Error(`备份中第 ${i + 1} 条留样的观察记录不是数组，整份备份已拒收`);
    }
  });

  [herbs, methods, batches, samples].forEach((list) => assertUniqueIds(list as Array<{ id: string }>, '记录'));
  assertUniqueNatural(herbs, (h) => herbKey(h.name, h.batchNo), '药材');
  assertUniqueNatural(methods, (m) => methodKey(m.name, m.auxiliary), '炮制方法');
  assertUniqueNatural(batches, (b) => batchKey(b.batchNo), '工序');
  assertUniqueNatural(samples, (s) => sampleKey(s.sampleNo), '留样');

  // 引用完整性：工序必须能找到药材与方法，留样必须能找到工序。
  // 允许来自备份自身或本机台账（班组可在本机原有药材/工序上继续记录），
  // 两边都找不到则整份拒收，杜绝“没有药材的工序”与没有工序的留样进入接收区。
  const herbIds = new Set([...herbs.map((h) => h.id), ...local.herbs.map((h) => h.id)]);
  const methodIds = new Set([...methods.map((m) => m.id), ...local.methods.map((m) => m.id)]);
  const batchIds = new Set([...batches.map((b) => b.id), ...local.batches.map((b) => b.id)]);
  batches.forEach((b, i) => {
    if (!herbIds.has(b.herbId)) {
      throw new Error(`备份中工序 ${b.batchNo}（第 ${i + 1} 条）引用的药材在备份与本机台账中都不存在，整份备份已拒收`);
    }
    if (!methodIds.has(b.methodId)) {
      throw new Error(`备份中工序 ${b.batchNo}（第 ${i + 1} 条）引用的炮制方法在备份与本机台账中都不存在，整份备份已拒收`);
    }
  });
  samples.forEach((s, i) => {
    if (!batchIds.has(s.batchId)) {
      throw new Error(`备份中留样 ${s.sampleNo}（第 ${i + 1} 条）引用的工序在备份与本机台账中都不存在，整份备份已拒收`);
    }
  });

  return {
    exportedAt: payload.exportedAt,
    machineId: payload.machineId,
    machineName: payload.machineName,
    herbs,
    methods,
    batches,
    samples,
  };
}

/* ------------------------------------------------------------------ */
/* 内容比对：同身份下判定一致还是冲突                                   */
/* ------------------------------------------------------------------ */

function herbSnapshot(h: HerbMaterial): string {
  return JSON.stringify(['HerbMaterial', h.name?.trim(), h.origin, h.part, h.batchNo?.trim(), Number(h.feedKg), h.receivedAt, h.remark?.trim() ?? '']);
}

function methodSnapshot(m: ProcessingMethod): string {
  return JSON.stringify([
    'ProcessingMethod',
    m.name,
    m.auxiliary,
    Number(m.auxRatio),
    m.fireLevel,
    [Number(m.tempRange?.[0]), Number(m.tempRange?.[1])],
    Number(m.duration),
    m.criterion?.trim(),
    m.criterionDimension,
    m.applicable?.trim(),
  ]);
}

function batchSnapshot(b: ProcessBatch): string {
  return JSON.stringify([
    'ProcessBatch',
    b.batchNo?.trim(),
    b.feedKg,
    b.auxUsedKg,
    b.fireLevel,
    b.startedAt,
    b.endedAt,
    b.yieldRate,
    b.degree,
    b.operator?.trim(),
    b.locked,
    b.lockedAt ?? '',
    b.qcBy ?? '',
    b.remark?.trim() ?? '',
  ]);
}

/** 观察记录去重键：日期 + 观察人 + 观察内容（同一条观察不重复追加） */
export function observeLogKey(log: ObserveLog): string {
  return JSON.stringify([log.date, log.observer?.trim(), log.color?.trim(), log.odor?.trim(), log.mold?.trim(), log.note?.trim() ?? '']);
}

/* ------------------------------------------------------------------ */
/* 分类：备份记录与本机记录比对，生成待接收区文档                       */
/* ------------------------------------------------------------------ */

interface LocalSnapshot {
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

function pairByKey<T>(
  incoming: T[],
  local: T[],
  keyOf: (row: T) => string,
  same: (a: T, b: T) => boolean,
): Array<InboxEntityEntry<T>> {
  const localByKey = new Map<string, T>();
  local.forEach((row) => localByKey.set(keyOf(row), row));

  return incoming.map((row) => {
    const key = keyOf(row);
    const localRow = localByKey.get(key);
    if (!localRow) {
      return { key, status: 'add', incoming: row };
    }
    if (same(localRow, row)) {
      return { key, status: 'identical', local: localRow, incoming: row };
    }
    // 默认建议以本机记录为主人（留样/质检判定归属质检机），质检员可改选。
    return { key, status: 'conflict', local: localRow, incoming: row, resolution: 'local' };
  });
}

function classifySamples(incoming: RetainSample[], local: RetainSample[]): InboxSampleEntry[] {
  const localByKey = new Map<string, RetainSample>();
  local.forEach((row) => localByKey.set(sampleKey(row.sampleNo), row));

  return incoming.map((row) => {
    const key = sampleKey(row.sampleNo);
    const localRow = localByKey.get(key);
    if (!localRow) {
      return { key, status: 'add', incoming: row, appendLogs: 0 };
    }
    const localLogKeys = new Set((localRow.observeLogs ?? []).map(observeLogKey));
    const freshLogs = (row.observeLogs ?? []).filter((log) => !localLogKeys.has(observeLogKey(log)));
    // 留样台账只追加：本机留样头信息永不由备份覆盖，仅补入新的观察记录。
    if (freshLogs.length === 0) {
      return { key, status: 'identical', local: localRow, incoming: row, appendLogs: 0 };
    }
    return { key, status: 'merge', local: localRow, incoming: row, appendLogs: freshLogs.length };
  });
}

/** 将校验过的备份与本机台账比对，生成待接收区（不触碰正式台账） */
export function buildInboxDoc(backup: ParsedBackup, local: LocalSnapshot): InboxDoc {
  return {
    id: 'current',
    createdAt: new Date().toISOString(),
    exportedAt: backup.exportedAt,
    machineId: backup.machineId,
    machineName: backup.machineName,
    herbs: pairByKey(
      backup.herbs,
      local.herbs,
      (h) => herbKey(h.name, h.batchNo),
      (a, b) => herbSnapshot(a) === herbSnapshot(b),
    ),
    methods: pairByKey(
      backup.methods,
      local.methods,
      (m) => methodKey(m.name, m.auxiliary),
      (a, b) => methodSnapshot(a) === methodSnapshot(b),
    ),
    batches: pairByKey(
      backup.batches,
      local.batches,
      (b) => batchKey(b.batchNo),
      (a, b) => batchSnapshot(a) === batchSnapshot(b),
    ),
    samples: classifySamples(backup.samples, local.samples),
  };
}

/* ------------------------------------------------------------------ */
/* 接收区统计                                                          */
/* ------------------------------------------------------------------ */

export function countInbox(doc: InboxDoc): InboxCounters {
  const counters: InboxCounters = { add: 0, conflict: 0, merge: 0, identical: 0, total: 0 };
  const bump = (status: InboxEntityEntry<unknown>['status'] | InboxSampleEntry['status']) => {
    counters[status] += 1;
    counters.total += 1;
  };
  doc.herbs.forEach((e) => bump(e.status));
  doc.methods.forEach((e) => bump(e.status));
  doc.batches.forEach((e) => bump(e.status));
  doc.samples.forEach((e) => bump(e.status));
  return counters;
}

/** 冲突条目数（冲突总有默认裁决，但接收前需质检员逐条确认主记录） */
export function conflictCount(doc: InboxDoc): number {
  return [...doc.herbs, ...doc.methods, ...doc.batches].filter((e) => e.status === 'conflict').length;
}
