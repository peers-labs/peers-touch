import type { PrototypeManifest } from "../../portal/src/registry/types";
import { isModelWireflow } from '../../shared/modelServiceWireflowState';

const manifest = {
  id: "station-dashboard",
  title: isModelWireflow() ? "Station Dashboard · 模型服务线框" : "Station Dashboard",
  site: "dashboard",
  host: "dashboard",
  kind: "shell",
  status: isModelWireflow() ? "drafting" : "pending-review",
  module: "station-dashboard",
  path: "packages/prototypes/dashboard/station-dashboard/",
  docs: "docs/architecture/platform/runtime/node-connectivity/relay-attachment/prototype/README.md",
  description:
    isModelWireflow() ? "安装、账号连接、模型验证与用户分配的完整交互线框；与 Desktop 联动。"
      : "Role-scoped Relay invitation and Station attachment lifecycle, including attach, recovery, migration, detach, and revoke.",
  order: 10,
  previewExport: "DashboardPrototype",
  entry: () => import("./src/DashboardPrototype"),
} satisfies PrototypeManifest;

export default manifest;
