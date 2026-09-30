import type { HerbMaterial } from './herb-material';
import type { ProcessingMethod } from './processing-method';
import type { ProcessBatch } from './process-batch';
import type { RetainSample } from './retain-sample';

/** 冲突主记录选择：本机现有记录或班组备份带来的记录 */
export type InboxMaster = 'local' | 'incoming';

/** 待接收条目的处置状态 */
export type InboxEntryStatus =
  | 'add' // 新增：备份有、本机无，可直接补入
  | 'identical' // 同一身份且内容一致，无需处理
  | 'conflict' // 同一身份但内容冲突，待质检员选主记录
  | 'merge'; // 留样：本机已有，只追加班组侧观察记录（留样台账只追加）

/** 药材/方法/工序的通用条目 */
export interface InboxEntityEntry<T> {
  /** 身份键（药材=名称+批号，方法=方法名+辅料，工序=生产批号） */
  key: string;
  status: InboxEntryStatus;
  /** 本机现有记录（存在即说明身份已匹配到本机记录） */
  local?: T;
  /** 班组备份记录 */
  incoming?: T;
  /** 冲突时质检员选定的主记录，默认 local */
  resolution?: InboxMaster;
}

/** 留样条目（本机留样只追加，不存在覆盖主记录的选择） */
export interface InboxSampleEntry {
  key: string;
  status: Extract<InboxEntryStatus, 'add' | 'identical' | 'merge'>;
  local?: RetainSample;
  incoming?: RetainSample;
  /** merge 时，待追加进本机留样的观察记录条数 */
  appendLogs: number;
}

/** 一次班组备份导入解析后、等待质检员接收的全部内容 */
export interface InboxDoc {
  /** 固定单行 id */
  id: 'current';
  createdAt: string;
  /** 备份导出时间 */
  exportedAt?: string;
  /** 备份来源机器标识 */
  machineId?: string;
  /** 备份来源机器名称 */
  machineName?: string;
  herbs: InboxEntityEntry<HerbMaterial>[];
  methods: InboxEntityEntry<ProcessingMethod>[];
  batches: InboxEntityEntry<ProcessBatch>[];
  samples: InboxSampleEntry[];
}

/** 待接收区分类计数 */
export interface InboxCounters {
  add: number;
  conflict: number;
  merge: number;
  identical: number;
  total: number;
}
