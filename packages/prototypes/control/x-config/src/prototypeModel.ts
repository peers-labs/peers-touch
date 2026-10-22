export type EntryKind = "relay" | "station" | "release";
export type Trust = "webpki" | "material" | "missing";
export type Entry = {
  id: string;
  kind: EntryKind;
  name: string;
  address: string;
  detail: string;
  trust: Trust;
  enabled: boolean;
  releaseVersion?: string;
  releaseTarget?: string;
  manifestDigest?: string;
  signingKeyId?: string;
};
export type PublicationState =
  | "clean"
  | "dirty"
  | "valid"
  | "publishing"
  | "failed"
  | "published"
  | "conflict";

export const INITIAL_ENTRIES: Entry[] = [
  { id: "relay-home", kind: "relay", name: "Home Relay", address: "https://relay.home.example", detail: "公开连接 · 家庭节点", trust: "webpki", enabled: true },
  { id: "station-demo", kind: "station", name: "社区体验 Station", address: "https://station.example.com", detail: "示例节点 · 所有者同意公开", trust: "webpki", enabled: true },
  { id: "release-desktop", kind: "release", name: "Desktop · macOS ARM64", address: "https://releases.example.com/desktop/manifest", detail: "0.0.1 · stable", trust: "webpki", enabled: true, releaseVersion: "0.0.1", releaseTarget: "macos-arm64", manifestDigest: "a".repeat(64), signingKeyId: "release-demo" },
];

export function validateEntries(entries: Entry[]): string[] {
  const findings: string[] = [];
  const urls = new Set<string>();
  for (const entry of entries.filter((value) => value.enabled)) {
    let url: URL;
    try { url = new URL(entry.address); } catch { findings.push(`${entry.name}：地址格式无效`); continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      findings.push(`${entry.name}：只支持不含账号密码的 HTTP(S) 地址`);
    }
    if (entry.kind !== "release" && (url.pathname !== "/" || url.search || url.hash)) {
      findings.push(`${entry.name}：接入地址不能携带路径、查询参数或片段`);
    }
    if (entry.kind === "release" && url.protocol !== "https:") {
      findings.push(`${entry.name}：升级地址必须使用 HTTPS`);
    }
    if (entry.kind === "release" && (!/^\d+\.\d+\.\d+([+-][\w.-]+)?$/.test(entry.releaseVersion ?? "") ||
      !entry.releaseTarget || !/^[a-f\d]{64}$/i.test(entry.manifestDigest ?? "") || !entry.signingKeyId?.trim())) {
      findings.push(`${entry.name}：请填写版本、目标平台、64 位摘要与签名 Key ID`);
    }
    if (entry.kind !== "release" && entry.trust === "missing") {
      findings.push(`${entry.name}：缺少可信连接材料，请向节点所有者获取`);
    }
    if (entry.kind !== "release" && url.protocol === "http:" && entry.trust !== "material") {
      findings.push(`${entry.name}：HTTP 发现必须预先携带可信节点身份`);
    }
    if (urls.has(entry.address)) findings.push(`${entry.name}：地址重复`);
    urls.add(entry.address);
  }
  return findings;
}

export function entryDiff(before: Entry[], after: Entry[]) {
  const changes: { id: string; name: string; description: string }[] = [];
  for (const current of after) {
    const prior = before.find((entry) => entry.id === current.id);
    if (!prior) changes.push({ id: current.id, name: current.name, description: `新增 · ${current.address}` });
    else if (JSON.stringify(prior) !== JSON.stringify(current)) {
      changes.push({ id: current.id, name: current.name, description: current.enabled !== prior.enabled ? (current.enabled ? "启用" : "停用") : `修改 · ${current.address}` });
    }
  }
  for (const prior of before) {
    if (!after.some((entry) => entry.id === prior.id)) changes.push({ id: prior.id, name: prior.name, description: "删除候选 · 已有客户端绑定保留" });
  }
  return changes;
}
