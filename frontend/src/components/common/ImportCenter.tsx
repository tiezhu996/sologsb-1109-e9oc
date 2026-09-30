import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  App as AntApp,
} from 'antd';
import { CloudUploadOutlined, MergeCellsOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useImportStore } from '../../stores/importStore';
import { useHerbStore } from '../../stores/herbStore';
import { useMethodStore } from '../../stores/methodStore';
import { useBatchStore } from '../../stores/batchStore';
import { useSampleStore } from '../../stores/sampleStore';
import type { HerbMaterial } from '../../types/herb-material';
import type { ProcessingMethod } from '../../types/processing-method';
import type { ProcessBatch } from '../../types/process-batch';
import type { ObserveLog, RetainSample } from '../../types/retain-sample';
import type { ImportEntityKind, ImportItem, ImportSession, ImportSide } from '../../types/import';

const { Text } = Typography;

type ResolvableKind = Exclude<ImportEntityKind, 'sample'>;

type AnyImportItem = ImportItem<HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample>;

function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join(' ~ ') + (typeof value[0] === 'number' ? ' ℃' : '');
  return String(value);
}

function descriptions(kind: ImportEntityKind, record?: HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample) {
  if (!record) return [];
  const fields: Record<ImportEntityKind, Array<[string, unknown]>> = {
    herb: [
      ['药材 / 批号', `${(record as HerbMaterial).name} / ${(record as HerbMaterial).batchNo}`],
      ['基原 / 部位', `${(record as HerbMaterial).origin} / ${(record as HerbMaterial).part}`],
      ['投料量', `${(record as HerbMaterial).feedKg} kg`],
      ['入库时间', (record as HerbMaterial).receivedAt],
      ['备注', (record as HerbMaterial).remark],
    ],
    method: [
      ['方法', `${(record as ProcessingMethod).name} · ${(record as ProcessingMethod).auxiliary}`],
      ['辅料比例', `${(record as ProcessingMethod).auxRatio} kg/100kg`],
      ['火力 / 时间', `${(record as ProcessingMethod).fireLevel} / ${(record as ProcessingMethod).duration} min`],
      ['温度区间', (record as ProcessingMethod).tempRange],
      ['判断标准', (record as ProcessingMethod).criterion],
      ['判断维度', (record as ProcessingMethod).criterionDimension],
      ['适用药材', (record as ProcessingMethod).applicable],
    ],
    batch: [
      ['生产批号', (record as ProcessBatch).batchNo],
      ['投料 / 辅料', `${(record as ProcessBatch).feedKg} kg / ${(record as ProcessBatch).auxUsedKg} kg`],
      ['火候', (record as ProcessBatch).fireLevel],
      ['开始 / 结束', `${(record as ProcessBatch).startedAt} ~ ${(record as ProcessBatch).endedAt}`],
      ['得率 / 程度', `${(record as ProcessBatch).yieldRate}% / ${(record as ProcessBatch).degree}`],
      ['操作人', (record as ProcessBatch).operator],
      ['质检状态', (record as ProcessBatch).locked ? `已锁定 · ${(record as ProcessBatch).qcBy ?? '质检员'}` : '待质检'],
      ['备注', (record as ProcessBatch).remark],
    ],
    sample: [
      ['留样编号', (record as RetainSample).sampleNo],
      ['留样量 / 期限', `${(record as RetainSample).amountG} g / ${(record as RetainSample).retainMonths} 个月`],
      ['柜位', (record as RetainSample).cabinet],
      ['留样日期', (record as RetainSample).retainedAt],
      ['观察记录数', (record as RetainSample).observeLogs.length],
    ],
  };
  return fields[kind].map(([label, value]) => ({ label, value }));
}

function RecordPanel({ title, kind, record, tone }: { title: string; kind: ImportEntityKind; record?: HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample; tone: 'local' | 'incoming' | 'empty' }) {
  return (
    <div>
      <Text strong style={{ color: tone === 'local' ? '#1f4d2e' : tone === 'incoming' ? '#ad6800' : undefined }}>
        {title}
      </Text>
      {record ? (
        <Descriptions size="small" column={1} bordered items={descriptions(kind, record).map((item) => ({ ...item, children: valueText(item.value) }))} />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无此侧记录" />
      )}
    </div>
  );
}

function LogTable({ logs }: { logs: ObserveLog[] }) {
  const columns: ColumnsType<ObserveLog> = [
    { title: '日期', dataIndex: 'date', width: 110 },
    { title: '色泽', dataIndex: 'color' },
    { title: '气味', dataIndex: 'odor' },
    { title: '霉变', dataIndex: 'mold' },
    { title: '观察人', dataIndex: 'observer', width: 100 },
  ];
  return <Table size="small" rowKey="id" columns={columns} dataSource={logs} pagination={false} />;
}

function ConflictRow({ kind, item }: { kind: ResolvableKind | 'sample'; item: AnyImportItem }) {
  const setResolution = useImportStore((s) => s.setResolution);
  const isSample = kind === 'sample';
  const chosen: ImportSide | undefined = isSample ? 'local' : item.chosen;
  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Text strong>{item.identityLabel}</Text>
        <Tag color="red">{kind === 'sample' ? '留样差异（只追加）' : '主记录冲突'}</Tag>
        {item.changedFields?.map((field) => <Tag key={field}>{field}</Tag>)}
      </Space>
      <Radio.Group
        value={chosen}
        disabled={isSample}
        onChange={(event) => setResolution(kind as ResolvableKind, item.identityLabel, event.target.value as ImportSide)}
        style={{ marginBottom: 12 }}
      >
        <Radio.Button value="local">以质检机记录为主</Radio.Button>
        <Radio.Button value="incoming">以班组备份为主</Radio.Button>
      </Radio.Group>
      {isSample && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="留样台账归属质检机，本机留样头信息始终保留；班组记录只会补充新增观察记录。"
        />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <RecordPanel title="质检机现有" kind={kind} record={item.local} tone={chosen === 'local' ? 'local' : 'empty'} />
        <RecordPanel title="班组备份" kind={kind} record={item.incoming} tone={chosen === 'incoming' ? 'incoming' : 'empty'} />
      </div>
      {isSample && item.appendedLogs && item.appendedLogs.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <Text strong>将追加的观察记录（{item.appendedLogs.length} 条）</Text>
          <LogTable logs={item.appendedLogs} />
        </>
      )}
    </div>
  );
}

type SimpleRecord = HerbMaterial | ProcessingMethod | ProcessBatch | RetainSample;

function simpleColumns<T extends SimpleRecord>(kind: ImportEntityKind, action: string): ColumnsType<ImportItem<T>> {
  return [
    { title: '业务身份', dataIndex: 'identityLabel', width: 360 },
    { title: action, key: 'action', width: 100, render: () => <Tag color="blue">{action}</Tag> },
    {
      title: '记录',
      key: 'detail',
      render: (_, item) => <Descriptions size="small" column={1} items={descriptions(kind, item.incoming ?? item.local).map((d) => ({ label: d.label, children: valueText(d.value) }))} />,
    },
  ];
}

function AppendTable({ items }: { items: ImportItem<RetainSample>[] }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {items.map((item) => (
        <div key={item.identityLabel} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Text strong>{item.identityLabel}</Text>
            <Tag color={item.action === 'append' ? 'gold' : 'green'}>{item.action === 'append' ? `追加 ${item.appendedLogs?.length ?? 0} 条观察` : '一致'}</Tag>
          </Space>
          {item.warning && <Alert type="warning" showIcon message={item.warning} style={{ marginBottom: 8 }} />}
          <RecordPanel title="本机留样（主记录）" kind="sample" record={item.local} tone="local" />
          {item.action === 'append' && item.appendedLogs && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <LogTable logs={item.appendedLogs} />
            </>
          )}
        </div>
      ))}
    </Space>
  );
}

function counts(session: ImportSession) {
  return {
    insert: session.analysis.herbs.filter((i) => i.action === 'insert').length
      + session.analysis.methods.filter((i) => i.action === 'insert').length
      + session.analysis.batches.filter((i) => i.action === 'insert').length
      + session.analysis.samples.filter((i) => i.action === 'insert').length,
    conflict:
      session.analysis.herbs.filter((i) => i.action === 'conflict').length
      + session.analysis.methods.filter((i) => i.action === 'conflict').length
      + session.analysis.batches.filter((i) => i.action === 'conflict').length
      + session.analysis.samples.filter((i) => i.action === 'conflict').length,
    append: session.analysis.samples.filter((i) => i.action === 'append').length,
  };
}

export default function ImportCenter() {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const session = useImportStore((s) => s.session);
  const stageBackup = useImportStore((s) => s.stageBackup);
  const discard = useImportStore((s) => s.discard);
  const commit = useImportStore((s) => s.commit);
  const hydrateHerbs = useHerbStore((s) => s.hydrate);
  const hydrateMethods = useMethodStore((s) => s.hydrate);
  const hydrateBatches = useBatchStore((s) => s.hydrate);
  const hydrateSamples = useSampleStore((s) => s.hydrate);

  const unresolved = useMemo(() => {
    if (!session) return 0;
    const pending = (items: AnyImportItem[]) => items.filter((item) => item.action === 'conflict' && item.chosen !== 'local' && item.chosen !== 'incoming').length;
    return pending(session.analysis.herbs) + pending(session.analysis.methods) + pending(session.analysis.batches);
  }, [session]);

  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    disabled: Boolean(session) || committing,
    beforeUpload: async (file) => {
      try {
        const errors = await stageBackup(await file.text(), file.name);
        if (errors.length) {
          message.error({ content: `班组备份未进入接收区：${errors[0]}${errors.length > 1 ? ` 等 ${errors.length} 个问题` : ''}`, duration: 6 });
        } else {
          message.success('班组备份已进入待接收区，正式台账尚未改变');
          setOpen(true);
        }
      } catch (error) {
        message.error(`读取备份失败：${(error as Error).message}`);
      }
      return false;
    },
  };

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const result = await commit();
      await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples()]);
      message.success(`合入完成：新增药材/方法/工序/留样 ${result.inserted.herb}/${result.inserted.method}/${result.inserted.batch}/${result.inserted.sample}，更新 ${result.updated.herb + result.updated.method + result.updated.batch} 条，追加观察 ${result.appendedLogs} 条`);
      setOpen(false);
    } catch (error) {
      message.error({ content: (error as Error).message, duration: 8 });
    } finally {
      setCommitting(false);
    }
  };

  const summary = session ? counts(session) : undefined;

  return (
    <>
      <Badge count={unresolved} size="small">
        <Button icon={<MergeCellsOutlined />} onClick={() => setOpen(true)}>
          班组备份合入
        </Button>
      </Badge>
      <Drawer
        title="班组备份待接收区"
        width={1040}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Popconfirm title="放弃整个接收区？" description="正式台账不会受影响，未提交的班组备份将被移除。" onConfirm={discard} disabled={!session || committing}>
              <Button disabled={!session || committing}>放弃接收区</Button>
            </Popconfirm>
            <Upload {...uploadProps}>
              <Button type={session ? 'default' : 'primary'} icon={<CloudUploadOutlined />} disabled={Boolean(session) || committing}>
                选择班组备份
              </Button>
            </Upload>
            <Button type="primary" disabled={!session || unresolved > 0} loading={committing} onClick={handleCommit}>
              选定后合入台账
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="接收区中的内容不会出现在药材、方法、工序或留样台账；质检员选定全部冲突主记录后，才在一个事务内提交。失败会回滚正式台账并保留接收区。"
        />
        {!session ? (
          <Empty description="暂无待合入备份。请选择班组导出的 JSON 文件。">
            <Upload {...uploadProps}>
              <Button type="primary" icon={<CloudUploadOutlined />}>选择班组备份</Button>
            </Upload>
          </Empty>
        ) : (
          <Tabs
            items={[
              {
                key: 'conflicts',
                label: <Badge count={summary?.conflict ?? 0} size="small" offset={[8, -2]}>冲突处理</Badge>,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Alert
                      type={unresolved ? 'warning' : 'success'}
                      showIcon
                      message={unresolved ? `还有 ${unresolved} 条药材/方法/工序冲突需要质检员选择主记录` : '冲突均已选定；本机留样将继续作为留样台账主记录'}
                    />
                    {[
                      ...session.analysis.herbs.filter((i) => i.action === 'conflict').map((item) => ({ kind: 'herb' as const, item })),
                      ...session.analysis.methods.filter((i) => i.action === 'conflict').map((item) => ({ kind: 'method' as const, item })),
                      ...session.analysis.batches.filter((i) => i.action === 'conflict').map((item) => ({ kind: 'batch' as const, item })),
                      ...session.analysis.samples.filter((i) => i.action === 'conflict').map((item) => ({ kind: 'sample' as const, item })),
                    ].length === 0 ? (
                      <Empty description="无冲突记录" />
                    ) : (
                      [
                        ...session.analysis.herbs.filter((i) => i.action === 'conflict').map((item) => <ConflictRow key={`herb-${item.identityLabel}`} kind="herb" item={item} />),
                        ...session.analysis.methods.filter((i) => i.action === 'conflict').map((item) => <ConflictRow key={`method-${item.identityLabel}`} kind="method" item={item} />),
                        ...session.analysis.batches.filter((i) => i.action === 'conflict').map((item) => <ConflictRow key={`batch-${item.identityLabel}`} kind="batch" item={item} />),
                        ...session.analysis.samples.filter((i) => i.action === 'conflict').map((item) => <ConflictRow key={`sample-${item.identityLabel}`} kind="sample" item={item} />),
                      ]
                    )}
                  </Space>
                ),
              },
              {
                key: 'insert',
                label: <Badge count={summary?.insert ?? 0} size="small" offset={[8, -2]}>新增记录</Badge>,
                children: (
                  <Tabs
                    items={[
                      { key: 'herb', label: `药材 (${session.analysis.herbs.filter((i) => i.action === 'insert').length})`, children: <Table rowKey="identityLabel" size="small" columns={simpleColumns<HerbMaterial>('herb', '补入药材')} dataSource={session.analysis.herbs.filter((i) => i.action === 'insert')} pagination={false} /> },
                      { key: 'method', label: `方法 (${session.analysis.methods.filter((i) => i.action === 'insert').length})`, children: <Table rowKey="identityLabel" size="small" columns={simpleColumns<ProcessingMethod>('method', '补入方法')} dataSource={session.analysis.methods.filter((i) => i.action === 'insert')} pagination={false} /> },
                      { key: 'batch', label: `工序 (${session.analysis.batches.filter((i) => i.action === 'insert').length})`, children: <Table rowKey="identityLabel" size="small" columns={simpleColumns<ProcessBatch>('batch', '补入工序')} dataSource={session.analysis.batches.filter((i) => i.action === 'insert')} pagination={false} /> },
                      { key: 'sample', label: `留样 (${session.analysis.samples.filter((i) => i.action === 'insert').length})`, children: <Table rowKey="identityLabel" size="small" columns={simpleColumns<RetainSample>('sample', '补入留样')} dataSource={session.analysis.samples.filter((i) => i.action === 'insert')} pagination={false} /> },
                    ]}
                  />
                ),
              },
              {
                key: 'append',
                label: <Badge count={summary?.append ?? 0} size="small" offset={[8, -2]}>留样追加/一致</Badge>,
                children: <AppendTable items={session.analysis.samples.filter((i) => i.action === 'append' || i.action === 'identical')} />,
              },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
