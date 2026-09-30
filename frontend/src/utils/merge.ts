import { db, SCHEMA_VERSION } from './db';
import { uid } from './id';
import { CRITERION_DIMENSIONS, type CriterionDimension, type ProcessingMethod } from '../types/processing-method';
import { FIRE_LEVELS, METHOD_NAMES, AUXILIARIES, type Auxiliary, type FireLevel, type MethodName } from '../types/processing-method';
import { HERB_ORIGINS, HERB_PARTS, type HerbMaterial, type HerbOrigin, type HerbPart } from '../types/herb-material';
import { PROCESS_DEGREES, type ProcessBatch, type ProcessDegree } from '../types/process-batch';
import type { ObserveLog, RetainSample } from '../types/retain-sample';
import type {
  ImportAnalysis,
  ImportCommitCounts,
  ImportEntityKind,
  ImportItem,
  ImportSession,
  ImportSide,
  ValidImportPayload,
} from '../types/import';

type RawRecord = Record<string, unknown>;

const HERB_OWNER_FIELDS: Array<[keyof HerbMaterial, string]> = [
  ['origin', '基原'],
  ['part', '药用部位'],
  ['feedKg', '投料量'],
  ['receivedAt', '入库时间'],
  ['remark', '备注'],
];
const METHOD_OWNER_FIELDS: Array<[keyof ProcessingMethod, string]> = [
  ['fireLevel', '火力'],
  ['tempRange', '温度区间'],
  ['duration', '炮制时间'],
  ['criterion', '判断标准'],
  ['criterionDimension', '判断维度'],
  ['applicable', '适用药材'],
];
const BATCH_OWNER_FIELDS: Array<[keyof ProcessBatch, string]> = [
  ['feedKg', '投料量'],
  ['auxUsedKg', '辅料用量'],
  ['fireLevel', '火候'],
  ['startedAt', '开始时间'],
  ['endedAt', '结束时间'],
  ['yieldRate', '得率'],
  ['degree', '程度判定'],
  ['operator', '操作人'],
  ['remark', '备注'],
];
const SAMPLE_OWNER_FIELDS: Array<[keyof RetainSample, string]> = [
  ['amountG', '留样量'],
  ['retainMonths', '留样期'],
  ['cabinet', '柜位'],
  ['retainedAt', '留样日期'],
];

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text ? text : undefined;
}

function requiredText(record: RawRecord, field: string, path: string, errors: string[]): string | undefined {
  const value = cleanText(record[field]);
  if (!value) {
    errors.push(`${path} 缺少必填字段：${field}`);
    return undefined;
  }
  return value;
}

function optionalText(record: RawRecord, field: string): string | undefined {
  return cleanText(record[field]);
}

function requiredNumber(record: RawRecord, field: string, path: string, errors: string[], min = 0): number | undefined {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    errors.push(`${path} 的 ${field} 必须是不小于 ${min} 的数字`);
    return undefined;
  }
  return value;
}

function enumValue<T extends string>(
  record: RawRecord,
  field: string,
  path: string,
  values: readonly T[],
  errors: string[],
): T | undefined {
  const value = requiredText(record, field, path, errors);
  if (!value) {
    return undefined;
  }
  if (!values.includes(value as T)) {
    errors.push(`${path} 的 ${field} 无效：${value}`);
    return undefined;
  }
  return value as T;
}

function validateHerb(value: unknown, index: number, errors: string[], usedIds: Set<string>): HerbMaterial | null {
  const path = `herbs[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  const id = requiredText(value, 'id', path, errors);
  const name = requiredText(value, 'name', path, errors);
  const batchNo = requiredText(value, 'batchNo', path, errors);
  const origin = enumValue(value, 'origin', path, HERB_ORIGINS, errors);
  const part = enumValue(value, 'part', path, HERB_PARTS, errors);
  const feedKg = requiredNumber(value, 'feedKg', path, errors);
  const receivedAt = requiredText(value, 'receivedAt', path, errors);
  if (id && usedIds.has(id)) errors.push(`${path} 的 id 重复：${id}`);
  if (id) usedIds.add(id);
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  return {
    id: id!,
    name: name!,
    origin: origin as HerbOrigin,
    part: part as HerbPart,
    batchNo: batchNo!,
    feedKg: feedKg!,
    receivedAt: receivedAt!,
    remark: optionalText(value, 'remark'),
  };
}

function validateMethod(value: unknown, index: number, errors: string[], usedIds: Set<string>): ProcessingMethod | null {
  const path = `methods[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  const id = requiredText(value, 'id', path, errors);
  const name = enumValue<MethodName>(value, 'name', path, METHOD_NAMES, errors);
  const auxiliary = enumValue<Auxiliary>(value, 'auxiliary', path, AUXILIARIES, errors);
  const auxRatio = requiredNumber(value, 'auxRatio', path, errors);
  const fireLevel = enumValue<FireLevel>(value, 'fireLevel', path, FIRE_LEVELS, errors);
  const duration = requiredNumber(value, 'duration', path, errors);
  const criterion = requiredText(value, 'criterion', path, errors);
  const criterionDimension = enumValue<CriterionDimension>(value, 'criterionDimension', path, CRITERION_DIMENSIONS, errors);
  const applicable = requiredText(value, 'applicable', path, errors);
  const rawRange = value.tempRange;
  let tempRange: [number, number] | undefined;
  if (!Array.isArray(rawRange) || rawRange.length !== 2 || rawRange.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    errors.push(`${path} 的 tempRange 必须是两个数字`);
  } else {
    tempRange = [Number(rawRange[0]), Number(rawRange[1])];
    if (tempRange[0] > tempRange[1]) errors.push(`${path} 的温度下限不能高于上限`);
  }
  const derivedFrom = optionalText(value, 'derivedFrom');
  if (id && usedIds.has(id)) errors.push(`${path} 的 id 重复：${id}`);
  if (id) usedIds.add(id);
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  return {
    id: id!,
    name: name!,
    auxiliary: auxiliary!,
    auxRatio: auxRatio!,
    fireLevel: fireLevel!,
    tempRange: tempRange!,
    duration: duration!,
    criterion: criterion!,
    criterionDimension: criterionDimension!,
    applicable: applicable!,
    ...(derivedFrom ? { derivedFrom } : {}),
  };
}

function validateBatch(value: unknown, index: number, errors: string[], usedIds: Set<string>): ProcessBatch | null {
  const path = `batches[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  const id = requiredText(value, 'id', path, errors);
  const batchNo = requiredText(value, 'batchNo', path, errors);
  const herbId = requiredText(value, 'herbId', path, errors);
  const methodId = requiredText(value, 'methodId', path, errors);
  const feedKg = requiredNumber(value, 'feedKg', path, errors);
  const auxUsedKg = requiredNumber(value, 'auxUsedKg', path, errors);
  const fireLevel = enumValue<FireLevel>(value, 'fireLevel', path, FIRE_LEVELS, errors);
  const startedAt = requiredText(value, 'startedAt', path, errors);
  const endedAt = requiredText(value, 'endedAt', path, errors);
  const yieldRate = requiredNumber(value, 'yieldRate', path, errors, -9999);
  const degree = enumValue<ProcessDegree>(value, 'degree', path, PROCESS_DEGREES, errors);
  const operator = requiredText(value, 'operator', path, errors);
  const locked = value.locked === undefined ? false : value.locked;
  if (typeof locked !== 'boolean') errors.push(`${path} 的 locked 必须是布尔值`);
  const lockedAt = optionalText(value, 'lockedAt');
  const qcBy = optionalText(value, 'qcBy');
  if (id && usedIds.has(id)) errors.push(`${path} 的 id 重复：${id}`);
  if (id) usedIds.add(id);
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  return {
    id: id!,
    batchNo: batchNo!,
    herbId: herbId!,
    methodId: methodId!,
    feedKg: feedKg!,
    auxUsedKg: auxUsedKg!,
    fireLevel: fireLevel!,
    startedAt: startedAt!,
    endedAt: endedAt!,
    yieldRate: yieldRate!,
    degree: degree!,
    operator: operator!,
    locked: locked as boolean,
    ...(lockedAt ? { lockedAt } : {}),
    ...(qcBy ? { qcBy } : {}),
    ...(optionalText(value, 'remark') ? { remark: optionalText(value, 'remark') } : {}),
  };
}

function validateLog(value: unknown, path: string, errors: string[]): ObserveLog | null {
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  const id = requiredText(value, 'id', path, errors);
  const date = requiredText(value, 'date', path, errors);
  const color = requiredText(value, 'color', path, errors);
  const odor = requiredText(value, 'odor', path, errors);
  const mold = requiredText(value, 'mold', path, errors);
  const observer = requiredText(value, 'observer', path, errors);
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  return {
    id: id!,
    date: date!,
    color: color!,
    odor: odor!,
    mold: mold!,
    observer: observer!,
    ...(optionalText(value, 'note') ? { note: optionalText(value, 'note') } : {}),
  };
}

function validateSample(value: unknown, index: number, errors: string[], usedIds: Set<string>): RetainSample | null {
  const path = `samples[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return null;
  }
  const id = requiredText(value, 'id', path, errors);
  const sampleNo = requiredText(value, 'sampleNo', path, errors);
  const batchId = requiredText(value, 'batchId', path, errors);
  const amountG = requiredNumber(value, 'amountG', path, errors);
  const retainMonths = requiredNumber(value, 'retainMonths', path, errors);
  const cabinet = requiredText(value, 'cabinet', path, errors);
  const retainedAt = requiredText(value, 'retainedAt', path, errors);
  if (!Array.isArray(value.observeLogs)) {
    errors.push(`${path} 的 observeLogs 必须是数组`);
  }
  if (id && usedIds.has(id)) errors.push(`${path} 的 id 重复：${id}`);
  if (id) usedIds.add(id);
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  const observeLogs = (value.observeLogs as unknown[]).map((log, logIndex) => validateLog(log, `${path}.observeLogs[${logIndex}]`, errors)).filter(Boolean) as ObserveLog[];
  if (errors.some((e) => e.startsWith(path))) {
    return null;
  }
  return {
    id: id!,
    sampleNo: sampleNo!,
    batchId: batchId!,
    amountG: amountG!,
    retainMonths: retainMonths!,
    cabinet: cabinet!,
    retainedAt: retainedAt!,
    observeLogs,
  };
}

function arrayField(record: RawRecord, field: string, errors: string[]): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    errors.push(`备份缺少数组字段：${field}`);
    return [];
  }
  return value;
}

/** 只做结构校验和文本规范化；业务身份在 analyzeImport 中判定。 */
export function parseBackupPayload(input: unknown): { data?: ValidImportPayload; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { errors: ['备份文件必须是 JSON 对象'] };
  }
  if (input.app !== 'gbherbprocess') {
    errors.push('备份文件格式不匹配（缺少 app=gbherbprocess 标记）');
  }
  if (typeof input.schemaVersion !== 'number' || !Number.isFinite(input.schemaVersion)) {
    errors.push('备份缺少有效的 schemaVersion');
  } else if (input.schemaVersion > SCHEMA_VERSION) {
    errors.push(`备份版本高于本机（${input.schemaVersion} > ${SCHEMA_VERSION}），请先升级本机`);
  }
  const herbRows = arrayField(input, 'herbs', errors);
  const methodRows = arrayField(input, 'methods', errors);
  const batchRows = arrayField(input, 'batches', errors);
  const sampleRows = arrayField(input, 'samples', errors);
  if (errors.length) {
    return { errors };
  }

  const herbs = herbRows.map((row, i) => validateHerb(row, i, errors, new Set<string>())).filter(Boolean) as HerbMaterial[];
  const methods = methodRows.map((row, i) => validateMethod(row, i, errors, new Set<string>())).filter(Boolean) as ProcessingMethod[];
  const batches = batchRows.map((row, i) => validateBatch(row, i, errors, new Set<string>())).filter(Boolean) as ProcessBatch[];
  const samples = sampleRows.map((row, i) => validateSample(row, i, errors, new Set<string>())).filter(Boolean) as RetainSample[];
  if (errors.length) {
    return { errors: Array.from(new Set(errors)) };
  }
  return {
    data: {
      ...(typeof input.exportedAt === 'string' ? { exportedAt: input.exportedAt } : {}),
      herbs,
      methods,
      batches,
      samples,
    },
    errors,
  };
}

export function parseBackupText(text: string): { data?: ValidImportPayload; errors: string[] } {
  try {
    return parseBackupPayload(JSON.parse(text));
  } catch {
    return { errors: ['备份不是合法 JSON 文件'] };
  }
}

export const herbIdentity = (herb: Pick<HerbMaterial, 'name' | 'batchNo'>): string => `${herb.name.trim()}｜${herb.batchNo.trim()}`;
export const methodIdentity = (method: Pick<ProcessingMethod, 'name' | 'auxiliary' | 'auxRatio'>): string =>
  `${method.name}｜${method.auxiliary}｜${Number(method.auxRatio)}kg/100kg`;
export const batchIdentity = (
  batch: Pick<ProcessBatch, 'batchNo'>,
  herb: Pick<HerbMaterial, 'name' | 'batchNo'>,
  method: Pick<ProcessingMethod, 'name' | 'auxiliary' | 'auxRatio'>,
): string => `${batch.batchNo.trim()}｜${herbIdentity(herb)}｜${methodIdentity(method)}`;
export const sampleIdentity = (sample: Pick<RetainSample, 'sampleNo'>, batch: Pick<ProcessBatch, 'batchNo'>, herb: Pick<HerbMaterial, 'name' | 'batchNo'>, method: Pick<ProcessingMethod, 'name' | 'auxiliary' | 'auxRatio'>): string =>
  `${sample.sampleNo.trim()}｜${batchIdentity(batch, herb, method)}`;

export const resolutionKey = (kind: ImportEntityKind, identity: string): string => `${kind}:${identity}`;

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (a === undefined || a === null || a === '') return b === undefined || b === null || b === '';
  if (b === undefined || b === null || b === '') return false;
  return a === b;
}

function changedFieldsOf<T extends object>(local: T, incoming: T, fields: Array<[keyof T, string]>): string[] {
  return fields.filter(([key]) => !sameValue(local[key], incoming[key])).map(([, label]) => label);
}

function logIdentity(log: ObserveLog): string {
  return [log.date, log.color, log.odor, log.mold, log.observer, log.note ?? ''].join('｜');
}

function indexByIdentity<T extends object>(rows: T[], keyOf: (row: T) => string, errors: string[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  rows.forEach((row) => {
    const key = keyOf(row);
    if (map.has(key)) errors.push(`${label}存在重复身份：${key}`);
    map.set(key, row);
  });
  return map;
}

function itemFor<T>(identityLabel: string, local: T | undefined, incoming: T | undefined, changedFields: string[] = []): ImportItem<T> {
  if (local && incoming) {
    return {
      identityLabel,
      local,
      incoming,
      changedFields,
      action: changedFields.length ? 'conflict' : 'identical',
    };
  }
  return { identityLabel, action: 'insert', ...(local ? { local } : {}), ...(incoming ? { incoming } : {}) };
}

export interface CurrentRecords {
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

/**
 * 业务身份不由两机各自生成的 id 决定：
 * 药材=名称+药材批号，方法=方法+辅料+配比，工序=生产批号+药材+方法，留样=留样号+工序。
 */
export function analyzeImport(current: CurrentRecords, data: ValidImportPayload, resolutions: Record<string, ImportSide> = {}): ImportAnalysis {
  const errors: string[] = [];
  const localHerbs = indexByIdentity(current.herbs, herbIdentity, errors, '本机药材');
  const incomingHerbs = indexByIdentity(data.herbs, herbIdentity, errors, '班组药材');
  const localMethods = indexByIdentity(current.methods, methodIdentity, errors, '本机方法');
  const incomingMethods = indexByIdentity(data.methods, methodIdentity, errors, '班组方法');

  const incomingHerbById = new Map(data.herbs.map((row) => [row.id, row]));
  const incomingMethodById = new Map(data.methods.map((row) => [row.id, row]));
  const incomingBatchById = new Map(data.batches.map((row) => [row.id, row]));

  const resolveIncomingBatch = (batch: ProcessBatch, index: number): { herb?: HerbMaterial; method?: ProcessingMethod } => {
    const herb = incomingHerbById.get(batch.herbId);
    const method = incomingMethodById.get(batch.methodId);
    if (!herb) errors.push(`batches[${index}] 引用的 herbId 不存在：${batch.herbId}`);
    if (!method) errors.push(`batches[${index}] 引用的 methodId 不存在：${batch.methodId}`);
    return { herb, method };
  };

  const batchKeys = new Map<string, { batch: ProcessBatch; herb: HerbMaterial; method: ProcessingMethod }>();
  data.batches.forEach((batch, index) => {
    const { herb, method } = resolveIncomingBatch(batch, index);
    if (herb && method) {
      const key = batchIdentity(batch, herb, method);
      if (batchKeys.has(key)) errors.push(`班组工序存在重复身份：${key}`);
      batchKeys.set(key, { batch, herb, method });
    }
  });

  const localBatchContext = new Map<string, { batch: ProcessBatch; herb?: HerbMaterial; method?: ProcessingMethod }>();
  current.batches.forEach((batch, index) => {
    const herb = current.herbs.find((row) => row.id === batch.herbId);
    const method = current.methods.find((row) => row.id === batch.methodId);
    if (!herb || !method) {
      errors.push(`本机 batches[${index}] 缺少药材或方法主记录，不能安全合入`);
      return;
    }
    const key = batchIdentity(batch, herb, method);
    if (localBatchContext.has(key)) errors.push(`本机工序存在重复身份：${key}`);
    localBatchContext.set(key, { batch, herb, method });
  });

  const sampleKeys = new Map<string, { sample: RetainSample; batch: ProcessBatch; herb: HerbMaterial; method: ProcessingMethod }>();
  data.samples.forEach((sample, index) => {
    const batch = incomingBatchById.get(sample.batchId);
    if (!batch) {
      errors.push(`samples[${index}] 引用的 batchId 不存在：${sample.batchId}`);
      return;
    }
    const herb = incomingHerbById.get(batch.herbId);
    const method = incomingMethodById.get(batch.methodId);
    if (!herb || !method) return;
    const key = sampleIdentity(sample, batch, herb, method);
    if (sampleKeys.has(key)) errors.push(`班组留样存在重复身份：${key}`);
    sampleKeys.set(key, { sample, batch, herb, method });
  });

  const localSampleContext = new Map<string, { sample: RetainSample; batch: ProcessBatch; herb: HerbMaterial; method: ProcessingMethod }>();
  current.samples.forEach((sample, index) => {
    const batch = current.batches.find((row) => row.id === sample.batchId);
    if (!batch) {
      errors.push(`本机 samples[${index}] 缺少工序主记录，不能安全合入`);
      return;
    }
    const herb = current.herbs.find((row) => row.id === batch.herbId);
    const method = current.methods.find((row) => row.id === batch.methodId);
    if (!herb || !method) return;
    const key = sampleIdentity(sample, batch, herb, method);
    if (localSampleContext.has(key)) errors.push(`本机留样存在重复身份：${key}`);
    localSampleContext.set(key, { sample, batch, herb, method });
  });

  const herbs = Array.from(new Set([...localHerbs.keys(), ...incomingHerbs.keys()])).map((key) => {
    const item = itemFor(key, localHerbs.get(key), incomingHerbs.get(key), localHerbs.get(key) && incomingHerbs.get(key)
      ? changedFieldsOf(localHerbs.get(key)!, incomingHerbs.get(key)!, HERB_OWNER_FIELDS)
      : []);
    if (item.action === 'conflict') item.chosen = resolutions[resolutionKey('herb', key)];
    return item;
  });

  const methods = Array.from(new Set([...localMethods.keys(), ...incomingMethods.keys()])).map((key) => {
    const item = itemFor(key, localMethods.get(key), incomingMethods.get(key), localMethods.get(key) && incomingMethods.get(key)
      ? changedFieldsOf(localMethods.get(key)!, incomingMethods.get(key)!, METHOD_OWNER_FIELDS)
      : []);
    const incoming = item.incoming;
    if (incoming && incoming.derivedFrom && !incomingMethods.has(incoming.derivedFrom) && !data.methods.some((row) => row.id === incoming.derivedFrom)) {
      item.warning = '班组记录中的派生来源未找到，提交时会保留方法内容并去掉派生关系';
    }
    if (item.action === 'conflict') item.chosen = resolutions[resolutionKey('method', key)];
    return item;
  });

  const batches = Array.from(new Set([...localBatchContext.keys(), ...batchKeys.keys()])).map((key) => {
    const local = localBatchContext.get(key)?.batch;
    const incoming = batchKeys.get(key)?.batch;
    const item = itemFor(key, local, incoming, local && incoming ? changedFieldsOf(local, incoming, BATCH_OWNER_FIELDS) : []);
    if (item.action === 'conflict') item.chosen = resolutions[resolutionKey('batch', key)];
    return item;
  });

  const samples = Array.from(new Set([...localSampleContext.keys(), ...sampleKeys.keys()])).map((key) => {
    const local = localSampleContext.get(key)?.sample;
    const incoming = sampleKeys.get(key)?.sample;
    if (local && incoming) {
      const changedFields = changedFieldsOf(local, incoming, SAMPLE_OWNER_FIELDS);
      const localLogs = new Set(local.observeLogs.map(logIdentity));
      const appendedLogs = incoming.observeLogs.filter((log) => !localLogs.has(logIdentity(log)));
      const action: ImportItem<RetainSample>['action'] = changedFields.length ? 'conflict' : appendedLogs.length ? 'append' : 'identical';
      const item: ImportItem<RetainSample> = {
        identityLabel: key,
        action,
        local,
        incoming,
        changedFields,
        appendedLogs,
        // 留样台账的主人始终是质检机；班组内容只能补观察记录，不能覆盖柜位/留样量等本机结论。
        chosen: 'local' as ImportSide,
        ...(changedFields.length ? { warning: '本机留样为主，班组留样头信息不会覆盖，仅追加观察记录' } : {}),
      };
      return item;
    }
    return itemFor(key, local, incoming);
  });

  return { errors: Array.from(new Set(errors)), herbs, methods, batches, samples };
}

export function getConflictItems(analysis: ImportAnalysis): Array<{ kind: ImportEntityKind; item: ImportItem<unknown> }> {
  return ([
    ...analysis.herbs.map((item) => ({ kind: 'herb' as const, item })),
    ...analysis.methods.map((item) => ({ kind: 'method' as const, item })),
    ...analysis.batches.map((item) => ({ kind: 'batch' as const, item })),
    ...analysis.samples.map((item) => ({ kind: 'sample' as const, item })),
  ]).filter(({ kind, item }) => item.action === 'conflict' && (kind === 'sample' ? item.chosen !== 'local' : item.chosen !== 'local' && item.chosen !== 'incoming'));
}

export async function readCurrentRecords(): Promise<CurrentRecords> {
  const [herbs, methods, batches, samples] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
  ]);
  return { herbs, methods, batches, samples };
}

function remapLogs(logs: ObserveLog[]): ObserveLog[] {
  return logs.map((log) => ({ ...log, id: uid('log') }));
}

/** 正式台账在一个 Dexie 事务内落库；任一步失败整体回滚，接收区仍保留。 */
export async function commitImportSession(session: ImportSession): Promise<ImportCommitCounts> {
  const current = await readCurrentRecords();
  const analysis = analyzeImport(current, session.data, session.resolutions);
  if (analysis.errors.length) {
    throw new Error(['接收区数据当前不能提交：', ...analysis.errors].join('\n'));
  }
  const unresolved = getConflictItems(analysis);
  if (unresolved.length) {
    throw new Error(`还有 ${unresolved.length} 条药材/方法/工序冲突未选择主记录`);
  }

  const counts: ImportCommitCounts = {
    inserted: { herb: 0, method: 0, batch: 0, sample: 0 },
    updated: { herb: 0, method: 0, batch: 0 },
    appendedLogs: 0,
  };
  const herbIds = new Map<string, string>();
  const methodIds = new Map<string, string>();
  const batchIds = new Map<string, string>();

  await db.transaction('rw', db.herbs, db.methods, db.batches, db.samples, db.importSessions, async () => {
    const herbsToPut: HerbMaterial[] = [];
    analysis.herbs.forEach((item) => {
      if (!item.incoming) return;
      if (item.local) {
        // 不按 id 认亲：同业务身份的记录复用质检机 id，保证既有工序/留样外键不悬空。
        herbIds.set(item.incoming.id, item.local.id);
        if (item.action === 'conflict' && item.chosen === 'incoming') {
          herbsToPut.push({ ...item.incoming, id: item.local.id });
          counts.updated.herb += 1;
        }
      } else {
        const id = uid('herb');
        herbIds.set(item.incoming.id, id);
        herbsToPut.push({ ...item.incoming, id });
        counts.inserted.herb += 1;
      }
    });

    const methodsToPut: ProcessingMethod[] = [];
    analysis.methods.forEach((item) => {
      if (!item.incoming) return;
      if (item.local) {
        methodIds.set(item.incoming.id, item.local.id);
        if (item.action === 'conflict' && item.chosen === 'incoming') {
          const sourceId = item.incoming.derivedFrom ? methodIds.get(item.incoming.derivedFrom) : undefined;
          methodsToPut.push({ ...item.incoming, id: item.local.id, ...(sourceId ? { derivedFrom: sourceId } : { derivedFrom: undefined }) });
          counts.updated.method += 1;
        }
      } else {
        const id = uid('method');
        methodIds.set(item.incoming.id, id);
        const sourceId = item.incoming.derivedFrom ? methodIds.get(item.incoming.derivedFrom) : undefined;
        methodsToPut.push({ ...item.incoming, id, ...(sourceId ? { derivedFrom: sourceId } : { derivedFrom: undefined }) });
        counts.inserted.method += 1;
      }
    });

    const batchesToPut: ProcessBatch[] = [];
    analysis.batches.forEach((item) => {
      if (!item.incoming) return;
      const targetHerbId = herbIds.get(item.incoming.herbId);
      const targetMethodId = methodIds.get(item.incoming.methodId);
      if (!targetHerbId || !targetMethodId) {
        throw new Error('工序缺少已合入的药材或方法主记录');
      }
      if (item.local) {
        batchIds.set(item.incoming.id, item.local.id);
        if (item.action === 'conflict' && item.chosen === 'incoming') {
          // 生产内容采用班组主记录；locked / qcBy 是本机质检结论，继续由本机保留。
          batchesToPut.push({
            ...item.incoming,
            id: item.local.id,
            herbId: targetHerbId,
            methodId: targetMethodId,
            locked: item.local.locked,
            lockedAt: item.local.lockedAt,
            qcBy: item.local.qcBy,
          });
          counts.updated.batch += 1;
        }
      } else {
        const id = uid('batch');
        batchIds.set(item.incoming.id, id);
        // 新工序进入本机后先由质检员复核，不能继承班组文件里的 locked / qcBy。
        batchesToPut.push({
          ...item.incoming,
          id,
          herbId: targetHerbId,
          methodId: targetMethodId,
          locked: false,
          lockedAt: undefined,
          qcBy: undefined,
        });
        counts.inserted.batch += 1;
      }
    });

    const samplesToPut: RetainSample[] = [];
    analysis.samples.forEach((item) => {
      if (!item.incoming) return;
      const targetBatchId = batchIds.get(item.incoming.batchId);
      if (!targetBatchId) throw new Error('留样缺少已合入的工序主记录');
      if (item.local) {
        const appended = item.appendedLogs ?? [];
        if (appended.length) {
          samplesToPut.push({ ...item.local, observeLogs: [...item.local.observeLogs, ...remapLogs(appended)] });
          counts.appendedLogs += appended.length;
        }
      } else {
        const id = uid('sample');
        samplesToPut.push({ ...item.incoming, id, batchId: targetBatchId, observeLogs: remapLogs(item.incoming.observeLogs) });
        counts.inserted.sample += 1;
      }
    });

    if (herbsToPut.length) await db.herbs.bulkPut(herbsToPut);
    if (methodsToPut.length) await db.methods.bulkPut(methodsToPut);
    if (batchesToPut.length) await db.batches.bulkPut(batchesToPut);
    if (samplesToPut.length) await db.samples.bulkPut(samplesToPut);
    await db.importSessions.delete(session.id);
  });

  return counts;
}
