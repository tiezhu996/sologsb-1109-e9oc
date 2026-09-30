import { db, getMeta, setMeta, SCHEMA_VERSION } from './db';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  /** 导出机器标识（两台机器合入时用于区分数据主人） */
  machineId: string;
  /** 机器名称（可在本机设置，仅作展示） */
  machineName?: string;
  herbs: unknown[];
  methods: unknown[];
  batches: unknown[];
  samples: unknown[];
}

const MACHINE_ID_KEY = 'machineId';
const MACHINE_NAME_KEY = 'machineName';

/** 本机机器标识：首次访问时生成并持久化，之后保持稳定 */
export async function getMachineId(): Promise<string> {
  const existed = await getMeta(MACHINE_ID_KEY);
  if (existed) {
    return existed;
  }
  const id = `machine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await setMeta(MACHINE_ID_KEY, id);
  return id;
}

export async function getMachineName(): Promise<string | undefined> {
  return getMeta(MACHINE_NAME_KEY);
}

export async function setMachineName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed) {
    await setMeta(MACHINE_NAME_KEY, trimmed);
  } else {
    await db.meta.delete(MACHINE_NAME_KEY);
  }
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [herbs, methods, batches, samples, machineId, machineName] = await Promise.all([
    db.herbs.toArray(),
    db.methods.toArray(),
    db.batches.toArray(),
    db.samples.toArray(),
    getMachineId(),
    getMachineName(),
  ]);
  return {
    app: 'gbherbprocess',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    machineId,
    machineName,
    herbs,
    methods,
    batches,
    samples,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（台账打印用） */
export function downloadCsv<T extends Record<string, unknown>>(filename: string, rows: T[], columns: Array<{ key: keyof T; title: string }>): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `﻿${header}\n${body}`, 'text/csv');
}
