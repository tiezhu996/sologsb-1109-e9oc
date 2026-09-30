import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Badge, Button, Descriptions, Drawer, Empty, Radio, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DiffOutlined,
  FileAddOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons';
import { useInboxStore } from '../stores/inboxStore';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { countInbox } from '../utils/merge';
import { formatDate } from '../utils/degree';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch } from '../types/process-batch';
import type { InboxEntityEntry, InboxMaster, InboxSampleEntry } from '../types/inbox';

const { Text, Paragraph } = Typography;

const STATUS_TAG: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  add: { color: 'green', text: '补入班组记录', icon: <FileAddOutlined /> },
  conflict: { color: 'red', text: '冲突·待选主记录', icon: <DiffOutlined /> },
  merge: { color: 'blue', text: '只追加观察记录', icon: <MergeCellsOutlined /> },
  identical: { color: 'default', text: '两边一致', icon: <CheckCircleOutlined /> },
};

interface FieldDef<T> {
  label: string;
  render: (row: T) => React.ReactNode;
}

function DiffValue({ value }: { value: React.ReactNode }) {
  return <span style={{ whiteSpace: 'pre-wrap' }}>{value === '' || value === undefined || value === null ? '—' : String(value)}</span>;
}

/** 字段级左右对照：仅冲突条目高亮差异（旧值划线、新值标红），补入条目直接显示值 */
function DiffCells<T>({ local, incoming, def }: { local?: T; incoming?: T; def: FieldDef<T> }) {
  const lv = local !== undefined ? def.render(local) : undefined;
  const iv = incoming !== undefined ? def.render(incoming) : undefined;
  const ls = lv === undefined ? '' : String(lv);
  const isv = iv === undefined ? '' : String(iv);
  const differ = local !== undefined && incoming !== undefined && ls !== isv;
  return {
    children: differ ? (
      <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }} align="start">
        <Text delete type="secondary">
          <DiffValue value={lv} />
        </Text>
        <Text strong style={{ color: '#cf1322' }}>
          <DiffValue value={iv} />
        </Text>
      </Space>
    ) : (
      <Text>
        <DiffValue value={incoming !== undefined ? iv : lv} />
      </Text>
    ),
    differ,
  };
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDate(d);
}

const HERB_FIELDS: Array<FieldDef<HerbMaterial>> = [
  { label: '基原', render: (h) => h.origin },
  { label: '药用部位', render: (h) => h.part },
  { label: '投料量(kg)', render: (h) => h.feedKg },
  { label: '入库日期', render: (h) => fmtTime(h.receivedAt) },
  { label: '备注', render: (h) => h.remark ?? '' },
];

const METHOD_FIELDS: Array<FieldDef<ProcessingMethod>> = [
  { label: '辅料用量(kg/100kg)', render: (m) => m.auxRatio },
  { label: '火力', render: (m) => m.fireLevel },
  { label: '温度区间(℃)', render: (m) => `${m.tempRange[0]}~${m.tempRange[1]}` },
  { label: '炮制时长(min)', render: (m) => m.duration },
  { label: '判断标准', render: (m) => m.criterion },
  { label: '侧重维度', render: (m) => m.criterionDimension },
  { label: '适用药材', render: (m) => m.applicable },
];

const BATCH_FIELDS: Array<FieldDef<ProcessBatch>> = [
  { label: '投料量(kg)', render: (b) => b.feedKg },
  { label: '辅料用量(kg)', render: (b) => b.auxUsedKg },
  { label: '火力', render: (b) => b.fireLevel },
  { label: '开始时间', render: (b) => fmtTime(b.startedAt) },
  { label: '结束时间', render: (b) => fmtTime(b.endedAt) },
  { label: '得率(%)', render: (b) => b.yieldRate },
  { label: '程度判定', render: (b) => b.degree },
  { label: '操作人', render: (b) => b.operator },
  { label: '锁定/质检', render: (b) => (b.locked ? `已锁定${b.qcBy ? ` · ${b.qcBy}` : ''}` : '待判定') },
  { label: '备注', render: (b) => b.remark ?? '' },
];

interface EntityTableProps<T extends { id: string }> {
  entries: Array<InboxEntityEntry<T>>;
  title: (row: T) => string;
  fields: Array<FieldDef<T>>;
  onResolve: (key: string, master: InboxMaster) => void;
  extraInfo?: (incoming: T) => React.ReactNode;
}

function EntityTable<T extends { id: string }>({ entries, title, fields, onResolve, extraInfo }: EntityTableProps<T>) {
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分类没有待接收记录" />;
  }

  const columns: TableColumnsType<InboxEntityEntry<T>> = [
    {
      title: '身份',
      width: 200,
      render: (_, entry) => {
        const tag = STATUS_TAG[entry.status];
        const name = entry.incoming ? title(entry.incoming) : entry.key;
        return (
          <Space direction="vertical" size={2}>
            <Text strong>{name}</Text>
            <Tag color={tag.color} icon={tag.icon} style={{ marginInlineEnd: 0 }}>
              {tag.text}
            </Tag>
            {entry.status === 'add' && entry.incoming && extraInfo ? extraInfo(entry.incoming) : null}
          </Space>
        );
      },
    },
    {
      title: '本机记录 → 班组记录（划掉项为将被替换的旧值，红色为新值）',
      render: (_, entry) => (
        <Descriptions column={1} size="small" bordered styles={{ label: { width: 150, padding: '4px 8px' }, content: { padding: '4px 8px' } }}>
          {fields.map((def) => {
            const cell = DiffCells({ local: entry.local, incoming: entry.incoming, def });
            return (
              <Descriptions.Item key={def.label} label={def.label}>
                {cell.children}
              </Descriptions.Item>
            );
          })}
        </Descriptions>
      ),
    },
    {
      title: '主记录',
      width: 190,
      render: (_, entry) =>
        entry.status === 'conflict' ? (
          <Radio.Group
            value={entry.resolution ?? 'local'}
            onChange={(e) => onResolve(entry.key, e.target.value as InboxMaster)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="local">以本机为主</Radio.Button>
            <Radio.Button value="incoming" style={{ background: entry.resolution === 'incoming' ? '#cf1322' : undefined }}>
              以班组为主
            </Radio.Button>
          </Radio.Group>
        ) : (
          <Text type="secondary">{entry.status === 'add' ? '直接补入' : entry.status === 'identical' ? '无需处理' : ''}</Text>
        ),
    },
  ];

  return (
    <Table rowKey="key" size="small" columns={columns} dataSource={entries} pagination={false} />
  );
}

interface SampleTableProps {
  entries: InboxSampleEntry[];
  batchLabel: (batchId: string) => string;
}

function SampleTable({ entries, batchLabel }: SampleTableProps) {
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分类没有待接收记录" />;
  }
  const columns: TableColumnsType<InboxSampleEntry> = [
    {
      title: '留样编号 / 状态',
      width: 220,
      render: (_, entry) => {
        const tag = STATUS_TAG[entry.status];
        return (
          <Space direction="vertical" size={2}>
            <Text strong>{entry.incoming?.sampleNo ?? entry.key}</Text>
            <Tag color={tag.color} icon={tag.icon} style={{ marginInlineEnd: 0 }}>
              {tag.text}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              所属工序：{entry.incoming ? batchLabel(entry.incoming.batchId) : entry.key}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '本机留样台账（只追加，不覆盖）',
      render: (_, entry) => {
        if (entry.status === 'add' && entry.incoming) {
          return (
            <Space direction="vertical" size={2}>
              <Text>新增留样 {entry.incoming.amountG}g，柜位 {entry.incoming.cabinet}，留样期 {entry.incoming.retainMonths} 个月</Text>
              <Text type="secondary">将挂到合入后的工序 {batchLabel(entry.incoming.batchId)}</Text>
            </Space>
          );
        }
        if (entry.status === 'merge' && entry.local && entry.incoming) {
          return (
            <Space direction="vertical" size={2}>
              <Text>本机留样保留，从班组备份追加 {entry.appendLogs} 条观察记录</Text>
              <Text type="secondary">柜位 {entry.local.cabinet} / {entry.local.amountG}g 等本机信息不变</Text>
            </Space>
          );
        }
        return <Text type="secondary">两边观察记录一致，无需处理</Text>;
      },
    },
  ];
  return <Table rowKey="key" size="small" columns={columns} dataSource={entries} pagination={false} />;
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** 合入成功后回调（触发各台账 store 重新装载） */
  onCommitted: () => void;
}

/** 班组备份待接收区：冲突左右对照、质检员选定主记录后整体合入 */
export default function ImportInboxDrawer({ open, onClose, onCommitted }: DrawerProps) {
  const { message, modal } = AntApp.useApp();
  const doc = useInboxStore((s) => s.doc);
  const resolveEntry = useInboxStore((s) => s.resolve);
  const discard = useInboxStore((s) => s.discard);
  const commit = useInboxStore((s) => s.commit);

  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const counters = useMemo(() => (doc ? countInbox(doc) : null), [doc]);

  /** 接收区里备份侧记录用的是备份 id，先查本机台账，查不到再从待接收记录里按 id 找 */
  const resolveHerbName = (id: string): string => {
    const local = herbs.find((h) => h.id === id);
    if (local) return local.name;
    const entry = doc?.herbs.find((e) => e.local?.id === id || e.incoming?.id === id);
    return entry?.incoming?.name ?? entry?.local?.name ?? '未知药材';
  };
  const resolveMethodName = (id: string): string => {
    const local = methods.find((m) => m.id === id);
    if (local) return local.name;
    const entry = doc?.methods.find((e) => e.local?.id === id || e.incoming?.id === id);
    return entry?.incoming?.name ?? entry?.local?.name ?? '未知方法';
  };

  const batchLabel = (batchId: string) => {
    const entry = doc?.batches.find((e) => e.local?.id === batchId || e.incoming?.id === batchId);
    const batch = batches.find((b) => b.id === batchId) ?? entry?.incoming ?? entry?.local;
    if (!batch) return '待合入工序';
    return `${batch.batchNo} · ${resolveHerbName(batch.herbId)} · ${resolveMethodName(batch.methodId)}`;
  };

  const doCommit = async () => {
    setCommitting(true);
    try {
      const result = await commit();
      message.success(`班组记录已合入：补入药材/方法/工序/留样相关记录共 ${result.add} 条，留样追加 ${result.merge} 类`);
      onCommitted();
      onClose();
    } catch (error) {
      message.error(`合入失败，正式台账未改动，接收区已保留：${(error as Error).message}`);
    } finally {
      setCommitting(false);
    }
  };

  const doDiscard = () => {
    modal.confirm({
      title: '放弃本次班组备份？',
      content: '记录尚未写入正式台账，放弃后仅清空待接收区，可重新导入备份文件。',
      okText: '放弃接收区',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDiscarding(true);
        try {
          await discard();
          message.success('已清空待接收区，本机台账未受影响');
          onClose();
        } finally {
          setDiscarding(false);
        }
      },
    });
  };

  const tabBadge = (list: Array<{ status: string }>, status: string) => {
    const n = list.filter((e) => e.status === status).length;
    return n > 0 ? <Badge count={n} size="small" color={STATUS_TAG[status].color} /> : null;
  };

  return (
    <Drawer
      title={
        <Space>
          <ClockCircleOutlined />
          <span>班组备份 · 待接收区</span>
          {counters?.conflict ? <Badge count={`${counters.conflict} 处冲突待确认`} style={{ backgroundColor: '#cf1322' }} /> : null}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={920}
      destroyOnClose={false}
      extra={
        <Space>
          <Button danger loading={discarding} onClick={doDiscard}>
            放弃接收区
          </Button>
          <Button type="primary" loading={committing} onClick={doCommit} disabled={!doc}>
            确认接收并合入台账
          </Button>
        </Space>
      }
    >
      {!doc || !counters ? (
        <Empty description="接收区为空" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="合入规则：先按药材、炮制方法、工序的同一身份归并，再补入班组记录；质检机留样只追加观察记录。冲突条目请在下方选定主记录，选定后才会进批次与留样台账。"
          />
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            备份来源：{doc.machineName || (doc.machineId ? `机器 ${doc.machineId.slice(-6)}` : '未标记机器')}
            {doc.exportedAt ? ` · 导出于 ${fmtTime(doc.exportedAt)}` : ''} · 接收时间 {fmtTime(doc.createdAt)}
          </Paragraph>
          <Space size={16} wrap>
            <Tag icon={<FileAddOutlined />} color="green">补入 {counters.add}</Tag>
            <Tag icon={<DiffOutlined />} color="red">冲突 {counters.conflict}</Tag>
            <Tag icon={<MergeCellsOutlined />} color="blue">留样追加 {counters.merge}</Tag>
            <Tag icon={<CheckCircleOutlined />}>一致 {counters.identical}</Tag>
          </Space>

          <Tabs
            defaultActiveKey="herbs"
            items={[
              {
                key: 'herbs',
                label: <span>药材 {tabBadge(doc.herbs, 'conflict')}{tabBadge(doc.herbs, 'add')}</span>,
                children: (
                  <EntityTable<HerbMaterial>
                    entries={doc.herbs}
                    title={(h) => `${h.name} · ${h.batchNo}`}
                    fields={HERB_FIELDS}
                    onResolve={(key, master) => resolveEntry('herbs', key, master)}
                  />
                ),
              },
              {
                key: 'methods',
                label: <span>炮制方法 {tabBadge(doc.methods, 'conflict')}{tabBadge(doc.methods, 'add')}</span>,
                children: (
                  <EntityTable<ProcessingMethod>
                    entries={doc.methods}
                    title={(m) => `${m.name} · ${m.auxiliary}`}
                    fields={METHOD_FIELDS}
                    onResolve={(key, master) => resolveEntry('methods', key, master)}
                  />
                ),
              },
              {
                key: 'batches',
                label: <span>工序 {tabBadge(doc.batches, 'conflict')}{tabBadge(doc.batches, 'add')}</span>,
                children: (
                  <>
                    {doc.batches.some((e) => e.status === 'conflict' && (e.resolution ?? 'local') === 'incoming' && e.local?.locked) ? (
                      <Alert
                        style={{ marginBottom: 8 }}
                        type="warning"
                        showIcon
                        message="有已锁定（质检员已判定）的本机工序被选为以班组记录为主，合入将以班组内容覆盖该批判定，请确认后再接收。"
                      />
                    ) : null}
                    <EntityTable<ProcessBatch>
                      entries={doc.batches}
                      title={(b) => b.batchNo}
                      fields={BATCH_FIELDS}
                      onResolve={(key, master) => resolveEntry('batches', key, master)}
                      extraInfo={(b) => (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {resolveHerbName(b.herbId)} · {resolveMethodName(b.methodId)}
                        </Text>
                      )}
                    />
                  </>
                ),
              },
              {
                key: 'samples',
                label: <span>留样（只追加）{tabBadge(doc.samples, 'add')}{tabBadge(doc.samples, 'merge')}</span>,
                children: <SampleTable entries={doc.samples} batchLabel={batchLabel} />,
              },
            ]}
          />
        </Space>
      )}
    </Drawer>
  );
}
