import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  ConfigProvider,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  type TableProps,
} from "antd";
import {
  Activity,
  ArrowRight,
  Check,
  CircleGauge,
  Copy,
  KeyRound,
  LayoutDashboard,
  Link2,
  Network,
  Plus,
  RefreshCw,
  Route,
  Server,
  ShieldCheck,
  Ticket,
  Unplug,
  UserRound,
  Users,
} from "lucide-react";
import {
  ATTACHMENT_STAGES,
  INITIAL_ATTACHMENTS,
  INITIAL_INVITATIONS,
  RELAY_AP,
  RELAY_EU,
  RELAY_SERVICE,
  STATION,
  buildRoutes,
  type AttachmentRow,
  type AttachmentState,
  type InvitationRow,
  type OperatorView,
  type RouteRow,
} from "./prototypeData";
import "./index.css";

const { Text, Title } = Typography;
const { TextArea } = Input;

type StationPage = "overview" | "attachments" | "routes" | "node";
type RelayPage = "invitations" | "attachments" | "service";
type AttachMode = "attach" | "migrate";
type ImportStep = "import" | "verified";

const SAMPLE_INVITATION =
  "pt-relay-invite:v1:relay-ap:12D3KooWRelayAP9tH4mQ2w8r:home-station:8XQ2-K7MP";

const stateMeta: Record<
  AttachmentState,
  { label: string; color: string }
> = {
  NOT_CONFIGURED: { label: "未配置", color: "default" },
  INVITE_ISSUED: { label: "邀请已签发", color: "blue" },
  STATION_ACCEPTED: { label: "已接受", color: "processing" },
  PROVING_IDENTITY: { label: "身份证明", color: "processing" },
  ENROLLING: { label: "准入中", color: "processing" },
  RESERVING: { label: "预留中", color: "processing" },
  PUBLISHING_ROUTE: { label: "发布路由", color: "processing" },
  ACTIVE: { label: "可用", color: "success" },
  RENEWING: { label: "续期中", color: "processing" },
  DEGRADED: { label: "降级", color: "warning" },
  RECOVERING: { label: "恢复中", color: "processing" },
  REVOKING: { label: "撤销中", color: "warning" },
  DETACHED: { label: "已卸载", color: "default" },
};

function AttachmentStateTag({ state }: { state: AttachmentState }) {
  const meta = stateMeta[state];
  return (
    <Tag className="state-tag" color={meta.color}>
      {meta.label}
    </Tag>
  );
}

function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <Title level={4}>{title}</Title>
        <Text type="secondary">{description}</Text>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <Text strong>{title}</Text>
        {description ? (
          <>
            <br />
            <Text type="secondary">{description}</Text>
          </>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function IdentityPanel({
  kind,
  name,
  peerId,
  origin,
}: {
  kind: "Station" | "Relay";
  name: string;
  peerId: string;
  origin: string;
}) {
  return (
    <div className="identity-panel">
      <span className="identity-mark">
        {kind === "Station" ? <Network size={19} /> : <Server size={19} />}
      </span>
      <div className="identity-main">
        <Space size={8}>
          <Text strong>{name}</Text>
          <Tag color="success">Ready</Tag>
        </Space>
        <br />
        <Text type="secondary">{kind} role process</Text>
      </div>
      <div className="identity-meta">
        <div className="mono">{peerId}</div>
        <Text type="secondary">{origin}</Text>
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={`nav-button ${active ? "active" : ""}`}
      icon={icon}
      onClick={onClick}
      type="text"
    >
      {label}
    </Button>
  );
}

export function DashboardPrototype() {
  const [messageApi, contextHolder] = message.useMessage();
  const [operatorView, setOperatorView] = useState<OperatorView>("station");
  const [stationPage, setStationPage] = useState<StationPage>("overview");
  const [relayPage, setRelayPage] = useState<RelayPage>("invitations");
  const [attachments, setAttachments] =
    useState<AttachmentRow[]>(INITIAL_ATTACHMENTS);
  const [invitations, setInvitations] =
    useState<InvitationRow[]>(INITIAL_INVITATIONS);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode>("attach");
  const [importStep, setImportStep] = useState<ImportStep>("import");
  const [invitationPackage, setInvitationPackage] =
    useState(SAMPLE_INVITATION);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuedPackage, setIssuedPackage] = useState("");
  const [migrationOpen, setMigrationOpen] = useState(false);

  const activeAttachments = useMemo(
    () => attachments.filter((item) => item.state !== "DETACHED"),
    [attachments],
  );
  const routes = useMemo(() => buildRoutes(attachments), [attachments]);

  const openAttachmentImport = (mode: AttachMode) => {
    setAttachMode(mode);
    setImportStep("import");
    setInvitationPackage(SAMPLE_INVITATION);
    setAttachOpen(true);
  };

  const verifyInvitation = () => {
    if (!invitationPackage.trim().startsWith("pt-relay-invite:")) {
      messageApi.error("无法验证邀请包，请粘贴 Relay 签发的完整内容。");
      return;
    }
    setImportStep("verified");
  };

  const attachDestination = () => {
    const destination: AttachmentRow = {
      key: "attachment-ap",
      relayName: RELAY_AP.name,
      relayPeerId: RELAY_AP.relayPeerId,
      controlOrigin: RELAY_AP.controlOrigin,
      stationName: STATION.name,
      stationPeerId: STATION.stationPeerId,
      nodePeerId: STATION.nodePeerId,
      generation: 1,
      visibility: "Public",
      state: "ACTIVE",
      credential: "53m remaining",
      reservation: "58m remaining",
      route: "57m remaining",
      observed: "now",
    };
    setAttachments((current) => [
      ...current.filter((item) => item.key !== destination.key),
      destination,
    ]);
    setAttachOpen(false);
    setStationPage("attachments");
    if (attachMode === "migrate") {
      setMigrationOpen(true);
    }
    messageApi.success(
      attachMode === "migrate"
        ? "目标 Relay 已独立挂载，源 Relay 保持可用。"
        : "Relay 已挂载并发布 Circuit 路由。",
    );
  };

  const detachRelay = (key: string) => {
    setAttachments((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              state: "DETACHED",
              route: "withdrawn",
              reservation: "closed",
              credential: "destroyed",
              detachedReason: "Station detached",
            }
          : item,
      ),
    );
    messageApi.success("本地路由已撤回，Station 不再使用该 Relay。");
  };

  const retryAttachment = (key: string) => {
    setAttachments((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, state: "ACTIVE", observed: "now", issue: undefined }
          : item,
      ),
    );
    messageApi.success("当前 generation 已恢复，未创建新的挂载。");
  };

  const revokeFromRelay = (key: string) => {
    setAttachments((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              state: "DETACHED",
              route: "withdrawn",
              reservation: "closed",
              credential: "revoked",
              detachedReason: "Relay revoked",
            }
          : item,
      ),
    );
    messageApi.success("准入已撤销，旧 generation 已失效。");
  };

  const issueInvitation = (values: {
    label: string;
    stationPeerId: string;
    clients: number;
    bandwidth: number;
  }) => {
    const nextPackage = `pt-relay-invite:v1:relay-eu:${RELAY_EU.relayPeerId}:${values.stationPeerId}:4PZ8-N6QK`;
    setInvitations((current) => [
      {
        key: `invite-${Date.now()}`,
        stationPeerId: values.stationPeerId,
        label: values.label,
        quota: `${values.clients} clients · ${values.bandwidth} MiB/s`,
        status: "Active",
        expires: "24h",
      },
      ...current,
    ]);
    setIssuedPackage(nextPackage);
  };

  const stationAttachmentColumns: TableProps<AttachmentRow>["columns"] = [
    {
      title: "Relay 节点",
      key: "relay",
      render: (_, row) => (
        <div>
          <Text strong>{row.relayName}</Text>
          <div className="mono">{row.relayPeerId}</div>
        </div>
      ),
    },
    {
      title: "Generation",
      dataIndex: "generation",
      width: 108,
      render: (value: number) => <span className="mono">gen {value}</span>,
    },
    {
      title: "凭据 / 预留 / 路由",
      key: "facts",
      width: 214,
      render: (_, row) => (
        <Text type="secondary">
          {row.credential} · {row.reservation} · {row.route}
        </Text>
      ),
    },
    {
      title: "状态",
      dataIndex: "state",
      width: 92,
      render: (state: AttachmentState) => (
        <AttachmentStateTag state={state} />
      ),
    },
    {
      title: "",
      key: "actions",
      width: 230,
      render: (_, row) =>
        row.state === "DETACHED" ? (
          <Text type="secondary">{row.detachedReason}</Text>
        ) : (
          <Space size={4}>
            {row.state === "DEGRADED" ? (
              <Button
                icon={<RefreshCw size={14} />}
                onClick={() => retryAttachment(row.key)}
                size="small"
              >
                恢复
              </Button>
            ) : null}
            <Button
              onClick={() => openAttachmentImport("migrate")}
              size="small"
            >
              迁移
            </Button>
            <Popconfirm
              title="卸载该 Relay？"
              description="Station 将先撤回本地路由，再关闭预留并销毁凭据。"
              okText="卸载"
              cancelText="取消"
              onConfirm={() => detachRelay(row.key)}
            >
              <Button danger icon={<Unplug size={14} />} size="small">
                卸载
              </Button>
            </Popconfirm>
          </Space>
        ),
    },
  ];

  const routeColumns: TableProps<RouteRow>["columns"] = [
    {
      title: "路由",
      key: "route",
      render: (_, row) => (
        <Space>
          {row.kind === "Direct" ? (
            <ShieldCheck size={16} />
          ) : (
            <Route size={16} />
          )}
          <div>
            <Text strong>{row.via}</Text>
            <br />
            <Text type="secondary">{row.kind}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: "目标",
      dataIndex: "destination",
      render: (value: string) => <span className="mono">{value}</span>,
    },
    { title: "可见性", dataIndex: "visibility", width: 110 },
    { title: "有效期", dataIndex: "expires", width: 120 },
    {
      title: "状态",
      dataIndex: "state",
      width: 100,
      render: (value: RouteRow["state"]) => (
        <Tag color={value === "Active" ? "success" : "warning"}>{value}</Tag>
      ),
    },
  ];

  const invitationColumns: TableProps<InvitationRow>["columns"] = [
    {
      title: "目标 Station",
      key: "station",
      render: (_, row) => (
        <div>
          <Text strong>{row.label}</Text>
          <div className="mono">{row.stationPeerId}</div>
        </div>
      ),
    },
    { title: "配额", dataIndex: "quota", width: 180 },
    { title: "有效期", dataIndex: "expires", width: 110 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: InvitationRow["status"]) => (
        <Tag color={value === "Active" ? "success" : "default"}>{value}</Tag>
      ),
    },
    {
      title: "",
      key: "action",
      width: 92,
      render: (_, row) =>
        row.status === "Active" ? (
          <Popconfirm
            title="撤销邀请？"
            okText="撤销"
            cancelText="取消"
            onConfirm={() =>
              setInvitations((current) =>
                current.map((item) =>
                  item.key === row.key
                    ? { ...item, status: "Revoked" }
                    : item,
                ),
              )
            }
          >
            <Button danger size="small">
              撤销
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  const relayAttachmentColumns: TableProps<AttachmentRow>["columns"] = [
    {
      title: "已准入 Station",
      key: "station",
      render: (_, row) => (
        <div>
          <Text strong>{row.stationName}</Text>
          <div className="mono">{row.stationPeerId}</div>
        </div>
      ),
    },
    {
      title: "Node PeerID",
      dataIndex: "nodePeerId",
      render: (value: string) => <span className="mono">{value}</span>,
    },
    {
      title: "Generation",
      dataIndex: "generation",
      width: 110,
      render: (value: number) => <span className="mono">gen {value}</span>,
    },
    {
      title: "状态",
      dataIndex: "state",
      width: 90,
      render: (state: AttachmentState) => (
        <AttachmentStateTag state={state} />
      ),
    },
    {
      title: "",
      key: "action",
      width: 116,
      render: (_, row) =>
        row.state !== "DETACHED" ? (
          <Popconfirm
            title="撤销该 Station 的准入？"
            description="Relay 将推进 generation 并拒绝旧凭据和路由。"
            okText="撤销准入"
            cancelText="取消"
            onConfirm={() => revokeFromRelay(row.key)}
          >
            <Button danger size="small">
              撤销准入
            </Button>
          </Popconfirm>
        ) : (
          <Text type="secondary">已清理</Text>
        ),
    },
  ];

  const stationContent = (() => {
    if (stationPage === "attachments") {
      return (
        <>
          <PageHeader
            title="Relay 挂载"
            description="当前 Station 可挂载多个彼此独立的 Relay 目标"
            actions={
              <Button
                icon={<Plus size={15} />}
                onClick={() => openAttachmentImport("attach")}
                type="primary"
              >
                导入 Relay 邀请
              </Button>
            }
          />
          <div className="page-canvas stable-page">
            <Alert
              showIcon
              type="info"
              title="每次挂载都从 Relay 签发的邀请包开始"
              description="不扫描、不推荐也不自动选择 Relay。迁移会创建新的独立挂载，源挂载在确认前保持可用。"
            />
            <section className="section">
              <SectionHeader
                title="已配置挂载"
                description="可用状态要求凭据、Circuit v2 预留、签名路由与 generation 一致"
              />
              <Table
                columns={stationAttachmentColumns}
                dataSource={attachments}
                pagination={false}
                scroll={{ x: 900 }}
              />
            </section>
          </div>
        </>
      );
    }

    if (stationPage === "routes") {
      return (
        <>
          <PageHeader
            title="路由候选"
            description="Direct 与各 Relay Circuit 路由保持独立"
          />
          <div className="page-canvas stable-page">
            <section className="section">
              <SectionHeader
                title="已验证路由"
                description="一个 Relay 的故障或撤销不会改写其他路由"
              />
              <Table
                columns={routeColumns}
                dataSource={routes}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </section>
          </div>
        </>
      );
    }

    if (stationPage === "node") {
      return (
        <>
          <PageHeader
            title="Station 节点"
            description="当前运行实例固定为 Station 角色"
          />
          <div className="page-canvas stable-page">
            <IdentityPanel
              kind="Station"
              name={STATION.name}
              origin={STATION.directOrigin}
              peerId={STATION.stationPeerId}
            />
            <section className="section">
              <SectionHeader
                title="运行身份"
                description="节点角色由启动配置决定，运行中不可切换"
              />
              <Descriptions
                className="padded-description"
                column={1}
                items={[
                  { key: "role", label: "Role", children: "station" },
                  {
                    key: "node",
                    label: "Node PeerID",
                    children: <span className="mono">{STATION.nodePeerId}</span>,
                  },
                  {
                    key: "relay",
                    label: "Relay pool",
                    children: `${activeAttachments.length} independent target(s)`,
                  },
                ]}
              />
            </section>
          </div>
        </>
      );
    }

    return (
      <>
        <PageHeader
          title="连接概览"
          description="Station 身份在 Direct 与 Relay 路由之间保持稳定"
          actions={
            <Button
              icon={<Plus size={15} />}
              onClick={() => openAttachmentImport("attach")}
              type="primary"
            >
              导入 Relay 邀请
            </Button>
          }
        />
        <div className="page-canvas stable-page">
          <IdentityPanel
            kind="Station"
            name={STATION.name}
            origin={STATION.directOrigin}
            peerId={STATION.stationPeerId}
          />
          <div className="fact-strip">
            <div className="fact">
              <Text type="secondary">可用路由</Text>
              <span className="fact-value">
                {routes.filter((item) => item.state === "Active").length}
              </span>
              <Text className="fact-detail" type="secondary">
                Direct + Circuit candidates
              </Text>
            </div>
            <div className="fact">
              <Text type="secondary">Relay 挂载</Text>
              <span className="fact-value">{activeAttachments.length}</span>
              <Text className="fact-detail" type="secondary">
                independent Relay generations
              </Text>
            </div>
            <div className="fact">
              <Text type="secondary">当前 Node</Text>
              <span className="fact-value">node-a</span>
              <Text className="fact-detail mono" type="secondary">
                {STATION.nodePeerId}
              </Text>
            </div>
          </div>
          <section className="section">
            <SectionHeader
              title="路由可用性"
              description="Relay 故障不会重写 Direct 候选"
              action={
                <Button
                  onClick={() => setStationPage("routes")}
                  type="text"
                >
                  查看全部 <ArrowRight size={14} />
                </Button>
              }
            />
            <Table
              columns={routeColumns}
              dataSource={routes}
              pagination={false}
              scroll={{ x: 760 }}
            />
          </section>
          <section className="section">
            <SectionHeader
              title="权限边界"
              description="邀请准入归 Relay，挂载意图与路由发布归 Station"
            />
            <div className="authority-flow">
              <div>
                <Text strong>Relay Operator</Text>
                <Text type="secondary">签发邀请 · 配额 · 撤销准入</Text>
              </div>
              <ArrowRight size={18} />
              <div>
                <Text strong>Station Operator</Text>
                <Text type="secondary">导入邀请 · 迁移 · 卸载</Text>
              </div>
              <ArrowRight size={18} />
              <div>
                <Text strong>Station Runtime</Text>
                <Text type="secondary">证明 · 预留 · 发布 · 续期</Text>
              </div>
            </div>
          </section>
        </div>
      </>
    );
  })();

  const relayContent = (() => {
    const relayOwnedAttachments = attachments.filter(
      (item) => item.relayPeerId === RELAY_EU.relayPeerId,
    );

    if (relayPage === "attachments") {
      return (
        <>
          <PageHeader
            title="已准入挂载"
            description="本 Relay 节点只管理自己签发的准入与 generation"
          />
          <div className="page-canvas stable-page">
            <section className="section">
              <SectionHeader
                title="当前挂载"
                description="撤销只影响本 Relay，不会修改其他 Relay 的预留"
              />
              <Table
                columns={relayAttachmentColumns}
                dataSource={relayOwnedAttachments}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </section>
          </div>
        </>
      );
    }

    if (relayPage === "service") {
      return (
        <>
          <PageHeader
            title="Relay 服务"
            description="当前运行实例固定为独立 Relay 角色进程"
          />
          <div className="page-canvas stable-page">
            <IdentityPanel
              kind="Relay"
              name={RELAY_EU.name}
              origin={RELAY_EU.controlOrigin}
              peerId={RELAY_EU.relayPeerId}
            />
            <div className="fact-strip">
              <div className="fact">
                <Text type="secondary">Reservations</Text>
                <span className="fact-value">
                  {RELAY_SERVICE.reservations}
                </span>
                <Text type="secondary">
                  of {RELAY_SERVICE.maxReservations}
                </Text>
              </div>
              <div className="fact">
                <Text type="secondary">Published routes</Text>
                <span className="fact-value">{RELAY_SERVICE.routes}</span>
                <Text type="secondary">volatile projections</Text>
              </div>
              <div className="fact">
                <Text type="secondary">Admitted nodes</Text>
                <span className="fact-value">
                  {RELAY_SERVICE.admittedNodes}
                </span>
                <Text type="secondary">this Relay only</Text>
              </div>
            </div>
            <Alert
              showIcon
              type="info"
              title="独立 Relay 节点"
              description="Relay Pool 是 Station 侧对多个独立 Relay 目标的配置；当前没有共享 Relay 集群身份或 Relay-to-Relay mesh。"
            />
          </div>
        </>
      );
    }

    return (
      <>
        <PageHeader
          title="准入邀请"
          description="本 Relay 为指定 Station 签发一次性、有期限的邀请"
          actions={
            <Button
              icon={<Plus size={15} />}
              onClick={() => {
                setIssuedPackage("");
                setIssueOpen(true);
              }}
              type="primary"
            >
              签发邀请
            </Button>
          }
        />
        <div className="page-canvas stable-page">
          <IdentityPanel
            kind="Relay"
            name={RELAY_EU.name}
            origin={RELAY_EU.controlOrigin}
            peerId={RELAY_EU.relayPeerId}
          />
          <section className="section">
            <SectionHeader
              title="邀请记录"
              description="明文 secret 仅在签发时显示一次"
            />
            <Table
              columns={invitationColumns}
              dataSource={invitations}
              pagination={false}
              scroll={{ x: 720 }}
            />
          </section>
        </div>
      </>
    );
  })();

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
          colorPrimary: "#21665a",
          colorText: "#1f2927",
          fontSize: 13,
        },
      }}
    >
      {contextHolder}
      <div className="app-shell">
        <aside className="side-nav">
          <div className="brand">
            <span className="brand-mark">
              {operatorView === "station" ? (
                <Network size={18} />
              ) : (
                <Server size={18} />
              )}
            </span>
            <div className="brand-copy">
              <Text strong>
                {operatorView === "station"
                  ? "Station Dashboard"
                  : "Relay Console"}
              </Text>
              <br />
              <Text type="secondary">
                {operatorView === "station" ? STATION.name : RELAY_EU.name}
              </Text>
            </div>
          </div>
          <nav className="nav-list">
            {operatorView === "station" ? (
              <>
                <NavButton
                  active={stationPage === "overview"}
                  icon={<LayoutDashboard size={16} />}
                  label="概览"
                  onClick={() => setStationPage("overview")}
                />
                <NavButton
                  active={stationPage === "attachments"}
                  icon={<Link2 size={16} />}
                  label="Relay 挂载"
                  onClick={() => setStationPage("attachments")}
                />
                <NavButton
                  active={stationPage === "routes"}
                  icon={<Route size={16} />}
                  label="路由"
                  onClick={() => setStationPage("routes")}
                />
                <NavButton
                  active={stationPage === "node"}
                  icon={<Server size={16} />}
                  label="节点"
                  onClick={() => setStationPage("node")}
                />
              </>
            ) : (
              <>
                <NavButton
                  active={relayPage === "invitations"}
                  icon={<Ticket size={16} />}
                  label="准入邀请"
                  onClick={() => setRelayPage("invitations")}
                />
                <NavButton
                  active={relayPage === "attachments"}
                  icon={<Users size={16} />}
                  label="已准入挂载"
                  onClick={() => setRelayPage("attachments")}
                />
                <NavButton
                  active={relayPage === "service"}
                  icon={<CircleGauge size={16} />}
                  label="Relay 服务"
                  onClick={() => setRelayPage("service")}
                />
              </>
            )}
          </nav>
          <Button
            className="operator-button"
            icon={<UserRound size={15} />}
            type="text"
          >
            A. Morgan
          </Button>
        </aside>
        <main className="work-area">
          <div className="context-bar acceptance-context">
            <Space size={8}>
              <Tag color="gold">原型验收专用</Tag>
              <Text strong>验收视角</Text>
              <Tooltip title="只切换两个独立模拟节点的运维界面；生产运行时没有此控件，也不会改变节点角色。">
                <Segmented
                  options={[
                    { label: "Station 节点", value: "station" },
                    { label: "Relay 节点", value: "relay" },
                  ]}
                  onChange={(value) =>
                    setOperatorView(value as OperatorView)
                  }
                  value={operatorView}
                />
              </Tooltip>
            </Space>
            <Text className="context-origin" type="secondary">
              {operatorView === "station"
                ? `${STATION.name} · role=station · ${STATION.stationPeerId}`
                : `${RELAY_EU.name} · role=relay · ${RELAY_EU.relayPeerId}`}
            </Text>
          </div>
          <div className="page-scroll">
            {operatorView === "station" ? stationContent : relayContent}
          </div>
        </main>
      </div>

      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setAttachOpen(false)}
        open={attachOpen}
        title={
          attachMode === "migrate"
            ? "导入目标 Relay 邀请并迁移"
            : "导入 Relay 邀请"
        }
        width={680}
      >
        {importStep === "import" ? (
          <div className="dialog-form">
            <Alert
              showIcon
              type="info"
              title="需要 Relay Operator 提供的邀请包"
              description="当前版本不提供 Relay 自动发现、目录、推荐或自动选择。"
            />
            <Form layout="vertical">
              <Form.Item
                label="邀请包"
                required
                style={{ marginTop: 18 }}
              >
                <TextArea
                  autoSize={{ minRows: 4, maxRows: 6 }}
                  onChange={(event) =>
                    setInvitationPackage(event.target.value)
                  }
                  value={invitationPackage}
                />
              </Form.Item>
              <Space className="dialog-actions">
                <Button onClick={() => setAttachOpen(false)}>取消</Button>
                <Button onClick={verifyInvitation} type="primary">
                  验证邀请
                </Button>
              </Space>
            </Form>
          </div>
        ) : (
          <div className="dialog-form">
            <Alert
              showIcon
              type="success"
              title="邀请签名与目标 Station 已验证"
              description="挂载只改变该 Node 的 Circuit 连接，不改变 Station 身份、Session、Federation 或业务权限。"
            />
            <Descriptions
              className="padded-description"
              column={1}
              items={[
                {
                  key: "relay",
                  label: "Relay",
                  children: RELAY_AP.name,
                },
                {
                  key: "peer",
                  label: "Relay PeerID",
                  children: (
                    <span className="mono">{RELAY_AP.relayPeerId}</span>
                  ),
                },
                {
                  key: "station",
                  label: "Intended Station",
                  children: (
                    <span className="mono">{STATION.stationPeerId}</span>
                  ),
                },
                {
                  key: "quota",
                  label: "Quota",
                  children: "8 clients · 64 MiB/s · expires in 24h",
                },
              ]}
            />
            <ol className="lifecycle-rail">
              {ATTACHMENT_STAGES.map((stage, index) => (
                <li className="lifecycle-stage complete" key={stage}>
                  <span className="stage-dot">
                    {index + 1}
                  </span>
                  <span>
                    <strong>{stateMeta[stage].label}</strong>
                    <small>{index === 5 ? "joined readback" : "owner fact"}</small>
                  </span>
                </li>
              ))}
            </ol>
            <Space className="dialog-actions">
              <Button onClick={() => setImportStep("import")}>返回</Button>
              <Button onClick={attachDestination} type="primary">
                {attachMode === "migrate" ? "挂载目标 Relay" : "确认并挂载"}
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setIssueOpen(false)}
        open={issueOpen}
        title="签发 Station 准入邀请"
        width={640}
      >
        {issuedPackage ? (
          <div className="dialog-form">
            <Alert
              showIcon
              type="warning"
              title="一次性 secret 仅显示本次"
              description="请通过受控渠道交给目标 Station Operator。"
            />
            <div className="secret-block">
              <span className="mono">{issuedPackage}</span>
              <Button
                aria-label="复制邀请包"
                icon={<Copy size={15} />}
                onClick={() => {
                  void navigator.clipboard.writeText(issuedPackage);
                  messageApi.success("邀请包已复制");
                }}
              />
            </div>
            <Button onClick={() => setIssueOpen(false)} type="primary">
              完成
            </Button>
          </div>
        ) : (
          <Form
            className="dialog-form"
            initialValues={{
              label: "Home Station",
              stationPeerId: STATION.stationPeerId,
              clients: 8,
              bandwidth: 64,
            }}
            layout="vertical"
            onFinish={issueInvitation}
          >
            <Form.Item
              label="Station 名称"
              name="label"
              rules={[{ required: true }]}
            >
              <Input prefix={<Network size={14} />} />
            </Form.Item>
            <Form.Item
              label="目标 Station PeerID"
              name="stationPeerId"
              rules={[{ required: true }]}
            >
              <Input prefix={<KeyRound size={14} />} />
            </Form.Item>
            <div className="form-grid">
              <Form.Item label="最大客户端" name="clients">
                <InputNumber min={1} />
              </Form.Item>
              <Form.Item label="带宽 MiB/s" name="bandwidth">
                <InputNumber min={1} />
              </Form.Item>
              <Form.Item label="有效期">
                <Input disabled value="24 hours" />
              </Form.Item>
            </div>
            <Space className="dialog-actions">
              <Button onClick={() => setIssueOpen(false)}>取消</Button>
              <Button htmlType="submit" icon={<Ticket size={15} />} type="primary">
                签发邀请
              </Button>
            </Space>
          </Form>
        )}
      </Modal>

      <Drawer
        onClose={() => setMigrationOpen(false)}
        open={migrationOpen}
        size={720}
        title="迁移确认"
      >
        <Alert
          showIcon
          type="success"
          title="两个 Relay 路由均已可用"
          description="目标挂载拥有独立 generation；源挂载尚未被修改。"
        />
        <div className="migration-map">
          <div>
            <Text type="secondary">源挂载</Text>
            <Text strong>{RELAY_EU.name}</Text>
            <AttachmentStateTag state="ACTIVE" />
          </div>
          <ArrowRight size={18} />
          <div>
            <Text type="secondary">目标挂载</Text>
            <Text strong>{RELAY_AP.name}</Text>
            <AttachmentStateTag state="ACTIVE" />
          </div>
        </div>
        <section className="section">
          <SectionHeader
            title="路由连续性"
            description="Direct 与源 Relay 在目标挂载验证期间持续可用"
          />
          <div className="route-summary">
            {routes
              .filter((route) => route.state === "Active")
              .map((route) => (
                <div className="route-summary-row" key={route.key}>
                  <span className="route-summary-icon">
                    {route.kind === "Direct" ? (
                      <ShieldCheck size={16} />
                    ) : (
                      <Route size={16} />
                    )}
                  </span>
                  <div className="route-summary-main">
                    <Text strong>{route.via}</Text>
                    <div className="mono">{route.destination}</div>
                  </div>
                  <Text type="secondary">{route.expires}</Text>
                  <Tag color="success">{route.state}</Tag>
                </div>
              ))}
          </div>
        </section>
        <Space className="dialog-actions">
          <Button onClick={() => setMigrationOpen(false)}>保留两个挂载</Button>
          <Button
            icon={<Check size={15} />}
            onClick={() => {
              detachRelay("attachment-eu");
              setMigrationOpen(false);
            }}
            type="primary"
          >
            卸载源 Relay
          </Button>
        </Space>
      </Drawer>
    </ConfigProvider>
  );
}

export default DashboardPrototype;
