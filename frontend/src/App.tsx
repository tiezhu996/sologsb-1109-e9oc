import { useEffect, useRef, useState } from 'react';
import { Layout, Menu, Spin, Typography, App as AntApp, Button, Space, Badge } from 'antd';
import {
  ExperimentOutlined,
  FireOutlined,
  InboxOutlined,
  ProfileOutlined,
  DashboardOutlined,
  DownloadOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { seedIfEmpty } from './utils/seed';
import { useHerbStore } from './stores/herbStore';
import { useMethodStore } from './stores/methodStore';
import { useBatchStore } from './stores/batchStore';
import { useSampleStore } from './stores/sampleStore';
import { useInboxStore } from './stores/inboxStore';
import { downloadText, exportBackupJson } from './utils/export';
import { countInbox } from './utils/merge';
import ImportInboxDrawer from './components/ImportInboxDrawer';

const { Header, Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;

const MENU_ITEMS = [
  { key: '/', icon: <DashboardOutlined />, label: <Link to="/">首页总览</Link> },
  { key: '/herbs', icon: <ExperimentOutlined />, label: <Link to="/herbs">药材台账</Link> },
  { key: '/methods', icon: <FireOutlined />, label: <Link to="/methods">炮制方法</Link> },
  { key: '/batches', icon: <ProfileOutlined />, label: <Link to="/batches">工序记录台</Link> },
  { key: '/samples', icon: <InboxOutlined />, label: <Link to="/samples">留样台账</Link> },
];

/** 应用外壳：左侧导航 + 顶部备份导出/班组备份合入，负责一次性的本地数据装载 */
export default function App() {
  const { message } = AntApp.useApp();
  const [ready, setReady] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const hydrateHerbs = useHerbStore((s) => s.hydrate);
  const hydrateMethods = useMethodStore((s) => s.hydrate);
  const hydrateBatches = useBatchStore((s) => s.hydrate);
  const hydrateSamples = useSampleStore((s) => s.hydrate);
  const hydrateInbox = useInboxStore((s) => s.hydrate);
  const inboxDoc = useInboxStore((s) => s.doc);
  const importToInbox = useInboxStore((s) => s.importToInbox);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await seedIfEmpty();
        await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples(), hydrateInbox()]);
      } catch (error) {
        message.error(`本地数据装载失败：${(error as Error).message}`);
      } finally {
        if (alive) {
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrateHerbs, hydrateMethods, hydrateBatches, hydrateSamples, hydrateInbox, message]);

  const selectedKey = MENU_ITEMS.map((item) => item.key)
    .filter((key) => (key === '/' ? location.pathname === '/' : location.pathname.startsWith(key)))
    .sort((a, b) => b.length - a.length)[0] ?? '/';

  const handleExport = async () => {
    const json = await exportBackupJson();
    downloadText(`gbherbprocess-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
    message.success('已导出 IndexedDB 全量 JSON 备份');
  };

  const pickFile = () => fileRef.current?.click();

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      // 只进待接收区；解析/校验失败时抛错，既有接收区与正式台账都不变。
      const counters = await importToInbox(text);
      message.success(
        `班组备份已读入待接收区：补入 ${counters.add} 条、冲突 ${counters.conflict} 处待确认、留样追加 ${counters.merge} 类`,
      );
      setInboxOpen(true);
    } catch (error) {
      message.error(`导入失败：${(error as Error).message}；接收区与本机台账保持原样`);
    } finally {
      setImporting(false);
    }
  };

  const handleCommitted = async () => {
    await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples()]);
  };

  const inboxBadge = inboxDoc ? countInbox(inboxDoc).add + countInbox(inboxDoc).conflict + countInbox(inboxDoc).merge : 0;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" width={208} style={{ background: '#1f4d2e' }}>
        <div style={{ padding: '16px 16px 8px' }}>
          <Title level={5} style={{ color: '#fff', margin: 0 }}>
            炮制工序记录台
          </Title>
          <Text style={{ color: '#a9c9b2', fontSize: 12 }}>gbherbprocess · 纯前端本地存储</Text>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={MENU_ITEMS} style={{ background: 'transparent' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong>中草药炮制工序记录台（质检机）</Text>
          <Space>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />
            <Button icon={<ImportOutlined />} loading={importing} onClick={pickFile}>
              导入班组备份
            </Button>
            <Badge count={inboxBadge} size="small" offset={[-6, 4]}>
              <Button icon={<InboxOutlined />} onClick={() => setInboxOpen(true)}>
                待接收区
              </Button>
            </Badge>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出备份
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 16 }}>
          {ready ? (
            <Outlet />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <Spin size="large" />
            </div>
          )}
        </Content>
        <Footer style={{ textAlign: 'center', color: '#8c9a90', padding: '12px 0' }}>
          数据保存在浏览器 IndexedDB（gbherbprocess-db），不依赖后端服务
        </Footer>
      </Layout>
      <ImportInboxDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} onCommitted={handleCommitted} />
    </Layout>
  );
}
