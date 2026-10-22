import type { PrototypeManifest } from "../../portal/src/registry/types";

const manifest = {
  id: "x-config",
  title: "X Config",
  site: "control",
  host: "control",
  kind: "shell",
  status: "confirmed",
  module: "x-config",
  path: "packages/prototypes/control/x-config/",
  docs: "docs/architecture/platform/client/control-plane/prototype/README.md",
  description: "官方节点与升级配置：草稿校验、版本差异、直接发布和失败恢复。",
  order: 20,
  previewExport: "XConfigPrototype",
  entry: () => import("./src/XConfigPrototype"),
} satisfies PrototypeManifest;

export default manifest;
