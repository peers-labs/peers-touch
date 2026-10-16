import type { PrototypeManifest } from "../../portal/src/registry/types";

const manifest = {
  id: "station-dashboard",
  title: "Station Dashboard",
  site: "dashboard",
  host: "dashboard",
  kind: "shell",
  status: "pending-review",
  module: "station-dashboard",
  path: "packages/prototypes/dashboard/station-dashboard/",
  docs: "docs/architecture/platform/runtime/node-connectivity/relay-attachment/prototype/README.md",
  description:
    "Role-scoped Relay invitation and Station attachment lifecycle, including attach, recovery, migration, detach, and revoke.",
  order: 10,
  previewExport: "DashboardPrototype",
  entry: () => import("./src/DashboardPrototype"),
} satisfies PrototypeManifest;

export default manifest;
