import { useEffect, useState, useSyncExternalStore } from "react";
import { Tag } from "@peers-touch/ui";
import { Flexbox } from "react-layout-kit";
import { RadioTower, Server } from "lucide-react";
import {
  api,
  type ClientMeta,
  type XConfigProjection,
} from "../../services/desktop_api";
import {
  getXConfigProjection,
  subscribeXConfigProjection,
} from "../../services/xConfig";

function short(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function MetaRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Flexbox horizontal justify="space-between" gap={12}>
      <span style={{ fontSize: 11, color: "var(--pt-muted)" }}>{label}</span>
      <span
        title={value}
        style={{
          fontSize: 11,
          color: "var(--pt-secondary)",
          fontFamily: mono ? "var(--pt-mono)" : "inherit",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 260,
        }}
      >
        {value}
      </span>
    </Flexbox>
  );
}

function DirectiveDefault({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: XConfigProjection["defaults"]["default_relay"];
}) {
  return (
    <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
      <span style={{ color: "var(--pt-muted)", display: "inline-flex" }}>
        {icon}
      </span>
      <span style={{ fontSize: 11, color: "var(--pt-muted)" }}>{label}</span>
      {value ? (
        <span
          title={`${value.seed_id} → ${value.canonical_origin}`}
          style={{
            fontSize: 11,
            color: value.actionable ? "var(--pt-primary)" : "var(--pt-muted)",
          }}
        >
          {value.display_name}
          {value.matched_rule_id
            ? ` · ${value.matched_rule_id}`
            : " · fallback"}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: "var(--pt-muted)" }}>—</span>
      )}
    </Flexbox>
  );
}

export function ClientMetaPanel() {
  const [meta, setMeta] = useState<ClientMeta | null>(null);
  const xConfig = useSyncExternalStore(
    subscribeXConfigProjection,
    getXConfigProjection,
    getXConfigProjection,
  );

  useEffect(() => {
    api
      .clientMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  return (
    <Flexbox
      horizontal
      gap={12}
      style={{
        padding: "8px 12px",
        border: "1px solid var(--pt-border)",
        borderRadius: 8,
        background: "var(--pt-surface)",
        alignItems: "stretch",
      }}
    >
      <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <strong style={{ fontSize: 12, color: "var(--pt-text)" }}>
            Client meta
          </strong>
          <Tag tone={meta?.packaged ? "success" : "neutral"}>
            {meta?.packaged ? "packaged" : "development"}
          </Tag>
        </Flexbox>
        <MetaRow
          label="product · flavor"
          value={`${meta?.product ?? "—"} · ${meta?.flavor ?? "—"}`}
        />
        <MetaRow
          label="version · build"
          value={`${meta?.version ?? "—"} #${meta?.build_number ?? "—"}`}
        />
        <MetaRow label="commit" value={short(meta?.commit)} />
        <MetaRow label="identifier" value={meta?.identifier ?? "—"} />
        <MetaRow
          label="channel · env"
          value={`${meta?.channel ?? "—"} · ${meta?.environment ?? "—"}`}
        />
        <MetaRow
          label="region (default)"
          value={`${meta?.region ?? "—"} (${meta?.default_region || "—"})`}
        />
        <MetaRow label="device id" value={short(meta?.device_id, 10, 8)} />
      </Flexbox>
      <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <strong style={{ fontSize: 12, color: "var(--pt-text)" }}>
            X Config
          </strong>
          <Tag tone={xConfig.freshness === "current" ? "success" : xConfig.freshness === "stale" ? "warning" : "neutral"}>
            {xConfig.freshness}
          </Tag>
        </Flexbox>
        <MetaRow label="channel" value={xConfig.channel} />
        <MetaRow
          label="sequence"
          value={xConfig.sequence ? `#${xConfig.sequence}` : "—"}
        />
        <MetaRow
          label="expires"
          value={
            xConfig.expires_at_unix_ms
              ? new Date(xConfig.expires_at_unix_ms).toISOString()
              : "—"
          }
        />
        <MetaRow label="last error" value={xConfig.last_refresh_error ?? "—"} />
        <Flexbox style={{ marginTop: 4 }} gap={4}>
          <DirectiveDefault
            icon={<RadioTower size={12} />}
            label="relay"
            value={xConfig.defaults?.default_relay ?? null}
          />
          <DirectiveDefault
            icon={<Server size={12} />}
            label="station"
            value={xConfig.defaults?.default_station ?? null}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
