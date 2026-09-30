# 中草药炮制工序记录台（gbherbprocess）

面向中药饮片厂炮制班组与质检员：登记药材批次、按炮制方法折算辅料比例与火力时间、逐批判定炮制程度、管理留样观察台账。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21809>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（5 条路由） |
| 状态 | Zustand（herbStore / methodStore / batchStore / sampleStore / inboxStore） |
| 存储 | IndexedDB（Dexie，库名 `gbherbprocess-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21809
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # herb-material / processing-method / process-batch / retain-sample
│       ├── stores/            # herbStore / methodStore / batchStore / sampleStore
│       ├── components/common/ # RatioCalculator / FireLevelTag / CabinetGrid / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── hooks/             # useHerbFilter / useRatio
│       ├── pages/             # ProcessBoard / HerbList / MethodList / BatchBoard / SampleLedger
│       ├── components/        # ImportInboxDrawer（班组备份待接收区）等
│       ├── router/index.tsx   # 路由表
│       └── utils/             # db.ts / degree.ts / export.ts / merge.ts / seed.ts / id.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页总览 | 待炮制批次、留样到期提示、最近工序时间线、平均得率 |
| `/herbs` | 药材台账 | 药材与批次登记，按基原/药用部位筛选，按药材分组汇总 |
| `/methods` | 炮制方法 | 辅料比例、火力与判断标准维护，辅料折算台与复制派生 |
| `/batches` | 工序记录台 | 选方法自动带出辅料比例/火候/判断标准，录入火候与得率并判定程度 |
| `/samples` | 留样台账 | 柜位网格、到期提醒、按日期追加观察记录 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbherbprocess-db`），表：`herbs`、`methods`、`batches`、`samples`、`meta`、`inbox`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为 `batches` 增加 `locked` 索引并回填历史数据；`db.version(3)` 增加 `inbox` 待接收区表（台账四表不做破坏性变更）。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例台账（`src/utils/seed.ts`），便于直接查看各页面效果。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

## 两台机器合入：班组备份 → 质检机

顶栏「导入班组备份」不再做整库覆盖，而是按下面的规则合入（逻辑见 `src/utils/merge.ts` 与 `src/stores/inboxStore.ts`）：

1. **身份判定（按现有记录的自然字段，不依赖各机自分配的 id）**
   - 药材：`名称 + 批次号`；炮制方法：`方法名 + 辅料`（同名不同辅料的派生方法是另一条）；工序：`生产批号`；留样：`留样编号`。
2. **先归并、再补入**：先按同一身份把药材、方法、工序对齐，班组独有的记录才补进台账；同身份且内容一致的跳过。
3. **留样只追加**：质检机本机留样头信息（柜位、留样量、留样期等）永不被备份覆盖，仅把备份中本机没有的观察记录去重后按日期追加。
4. **冲突进待接收区**：同身份但内容不一致时，记录先进 `inbox` 待接收区，由质检员在抽屉中左右对照、逐条「以本机为主 / 以班组为主」选定主记录；已锁定（质检员已判定）的工序若改选班组为主会额外警示。默认建议以本机记录为主人。
5. **顺序与完整性**：最终合入在单个 Dexie 事务内按「药材 → 方法 → 工序 → 留样」写入，工序的药材/方法引用重映射到合入后的 id，留样重挂到合入后的工序；引用在备份与本机两边都解析不到的备份整份拒收，保证不会出现没有药材的工序、没有工序的留样。
6. **失败原子性**：导入只写 `inbox`，不触碰正式台账；接收区非空时拒绝再次导入；合入失败（含接收期间本机台账已变化）整体回滚并保留接收区，不会露出半套数据。成功后才清空接收区。
7. 备份文件含 `machineId`（首次导出时自动生成并持久化），用于在接收区显示数据来源机器。
