import type { HerbMaterial } from './herb-material';
import type { ProcessingMethod } from './processing-method';
import type { ProcessBatch } from './process-batch';
import type { ObserveLog, RetainSample } from './retain-sample';

export type ImportEntityKind = 'herb' | 'method' | 'batch' | 'sample';
export type ImportSide = 'local' | 'incoming';
export type ImportItemAction = 'insert' | 'identical' | 'conflict' | 'append';

export interface ImportItem<T> {
  /** 业务身份，不使用两台机器各自生成的 id 判定 */
  identityLabel: string;
  action: ImportItemAction;
  local?: T;
  incoming?: T;
  /** 药材 / 方法 / 工序冲突时由质检员选择的主记录 */
  chosen?: ImportSide;
  changedFields?: string[];
  /** 本机留样保留时，将从班组备份追加的观察记录 */
  appendedLogs?: ObserveLog[];
  warning?: string;
}

export interface ValidImportPayload {
  exportedAt?: string;
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  batches: ProcessBatch[];
  samples: RetainSample[];
}

export interface ImportAnalysis {
  errors: string[];
  herbs: ImportItem<HerbMaterial>[];
  methods: ImportItem<ProcessingMethod>[];
  batches: ImportItem<ProcessBatch>[];
  samples: ImportItem<RetainSample>[];
}

export interface ImportSession {
  id: 'active-import';
  status: 'waiting';
  fileName: string;
  createdAt: string;
  sourceExportedAt?: string;
  data: ValidImportPayload;
  /** key: `${kind}:${identityLabel}`，刷新后仍保留质检员已作的主记录选择 */
  resolutions: Record<string, ImportSide>;
  analysis: ImportAnalysis;
}

export interface ImportCommitCounts {
  inserted: Record<ImportEntityKind, number>;
  updated: Record<Exclude<ImportEntityKind, 'sample'>, number>;
  appendedLogs: number;
}
