import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Button,
  Empty,
  Icon,
  IconButton,
  Switch,
  Tag,
  TextField,
  type Tone,
} from "@peers-touch/ui";
import { useTranslation } from "react-i18next";
import { api } from "../services/desktop_api";
import { log } from "../utils/logger";
import { ClientMetaPanel } from "./debug/ClientMetaPanel";
import { SettingsContainer, SettingsPanelHeader } from "./settings/SettingsLayout";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  information: "info",
  warn: "warn",
  warning: "warn",
  err: "error",
  error: "error",
  fatal: "fatal",
  panic: "fatal",
};

const LEVEL_TONES: Record<LogLevel, Tone> = {
  trace: "neutral",
  debug: "info",
  info: "success",
  warn: "warning",
  error: "danger",
  fatal: "danger",
};

interface LogEntry {
  raw: string;
  time?: string;
  level?: LogLevel;
  subsystem?: string;
  message: string;
}

function unescapeLogfmt(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
}

function extractLogfmtField(line: string, field: string): string | undefined {
  const re = new RegExp(field + '="((?:[^"\\\\]|\\\\.)*)"');
  const m = line.match(re);
  if (m) return unescapeLogfmt(m[1]);
  const reSimple = new RegExp(field + "=([^ ]+)");
  const ms = line.match(reSimple);
  return ms ? ms[1] : undefined;
}

function normalizeLevel(raw?: string): LogLevel | undefined {
  if (!raw) return undefined;
  return LEVEL_ALIASES[raw.toLowerCase()];
}

function parseLogLine(line: string): LogEntry {
  const trimmed = line.trim();
  if (!trimmed) return { raw: line, message: line };

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);

      if (obj.timestamp && obj.level && obj.target) {
        const fields = { ...obj };
        delete fields.timestamp;
        delete fields.level;
        delete fields.target;
        delete fields.message;
        const extras = Object.entries(fields)
          .map(
            ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join(" ");
        const msg = extras
          ? `${obj.message || ""} ${extras}`
          : obj.message || "";
        return {
          raw: line,
          time: obj.timestamp,
          level: normalizeLevel(obj.level),
          subsystem: obj.target,
          message: msg.trim(),
        };
      }

      const meta = obj._meta || {};
      let msg =
        obj.msg ||
        obj.message ||
        (typeof obj["1"] === "string"
          ? obj["1"]
          : typeof obj["0"] === "string"
            ? obj["0"]
            : line);
      if (obj.req) msg += " | req=" + obj.req;
      if (obj.rsp) msg += " | rsp=" + obj.rsp;
      return {
        raw: line,
        time: obj.time || meta.date,
        level:
          normalizeLevel(meta.logLevelName || meta.level || obj.level) ||
          "info",
        subsystem:
          obj.pkg ||
          obj.subsystem ||
          (typeof obj["0"] === "string" && obj["0"].length < 50
            ? obj["0"]
            : undefined),
        message: msg,
      };
    } catch {
      // fallback to text parsing
    }
  }

  const entry: LogEntry = { raw: line, message: line };

  const timeMatch = line.match(/time="([^"]+)"/);
  if (timeMatch) entry.time = timeMatch[1];

  const levelQuoted = extractLogfmtField(line, "level");
  const levelSimple = line.match(/(?:^|\s)level=([^\s"]+)/)?.[1];
  entry.level = normalizeLevel(levelQuoted || levelSimple);

  const msgVal = extractLogfmtField(line, "msg");
  if (msgVal) {
    entry.message = msgVal;
    const req = extractLogfmtField(line, "req");
    const rsp = extractLogfmtField(line, "rsp");
    if (req) entry.message += " | req=" + req;
    if (rsp) entry.message += " | rsp=" + rsp;
  }

  const pkgMatch = line.match(/pkg=([^ ]+)/);
  if (pkgMatch) entry.subsystem = pkgMatch[1];

  return entry;
}

export function LogsTab() {
  const { t } = useTranslation("provider");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<number>(-1);
  const [autoFollow, setAutoFollow] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>({
    trace: true,
    debug: true,
    info: true,
    warn: true,
    error: true,
    fatal: true,
  });
  const [paused, setPaused] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<number>(-1);
  const fileRef = useRef('');
  const loadingRef = useRef(false);
  const pausedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const LOG_LINE_HEIGHT = 22;
  const getMaxLines = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 200;
    return Math.max(50, Math.ceil(el.clientHeight / LOG_LINE_HEIGHT) * 3);
  }, []);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const mergeEntries = useCallback(
    (prev: LogEntry[], incoming: LogEntry[]) => {
      if (incoming.length === 0) return prev;
      const maxOverlap = Math.min(prev.length, incoming.length);
      let overlap = 0;
      for (let candidate = maxOverlap; candidate > 0; candidate--) {
        let matched = true;
        for (let i = 0; i < candidate; i++) {
          if (prev[prev.length - candidate + i]?.raw !== incoming[i]?.raw) {
            matched = false;
            break;
          }
        }
        if (matched) {
          overlap = candidate;
          break;
        }
      }
      const maxLines = getMaxLines();
      return [...prev, ...incoming.slice(overlap)].slice(-maxLines);
    },
    [getMaxLines],
  );

  const fetchLogs = useCallback(async (reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const currentCursor = reset ? -1 : cursorRef.current;
      const fetchCount = Math.min(getMaxLines(), 500);
      let res = await api.tailLogs(currentCursor, fetchCount, fetchCount * 200);
      const fileChanged = Boolean(fileRef.current && fileRef.current !== res.file);
      if (!reset && fileChanged) {
        res = await api.tailLogs(-1, fetchCount, fetchCount * 200);
      }
      const newEntries = (res.lines || []).map(parseLogLine);

      if (res.reset || reset || fileChanged) {
        setEntries(newEntries);
      } else if (newEntries.length > 0) {
        setEntries(prev => mergeEntries(prev, newEntries));
      }
      fileRef.current = res.file;
      cursorRef.current = res.cursor;
      setCursor(res.cursor);
    } catch (err) {
      log.error('LogsTab', 'Failed to load logs', err);
    } finally {
      loadingRef.current = false;
    }
  }, [getMaxLines, mergeEntries]);

  useEffect(() => {
    if (autoFollow && !paused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [entries, autoFollow, paused]);

  useEffect(() => {
    fetchLogs(true);
    const interval = window.setInterval(() => {
      if (!pausedRef.current) {
        void fetchLogs();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const level = e.level || "info";
      if (!levelFilters[level]) return false;
      if (!filterText) return true;
      const search = filterText.toLowerCase();
      return (
        e.message.toLowerCase().includes(search) ||
        e.subsystem?.toLowerCase().includes(search) ||
        e.raw.toLowerCase().includes(search)
      );
    });
  }, [entries, filterText, levelFilters]);

  const onlyWarningsAndAbove = () => {
    setLevelFilters({
      trace: false,
      debug: false,
      info: false,
      warn: true,
      error: true,
      fatal: true,
    });
  };

  const handleExport = () => {
    const content = filteredEntries.map((e) => e.raw).join("");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `peers-touch-${new Date().toISOString()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (timeStr?: string) => {
    if (!timeStr) return "";
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleTimeString([], { hour12: false });
    } catch {
      return timeStr;
    }
  };

  return (
    <SettingsContainer tier="standard">
      <SettingsPanelHeader
        icon={<Icon iconId="file-text" size={20} className="sc-logs-title-icon" />}
        title={t("provider.logs.title")}
        subtitle={t("provider.logs.subtitle")}
        actions={(
          <>
            <IconButton
              actionId="logs-toggle-pause"
              iconId={paused ? "play" : "pause"}
              iconSize={14}
              density="compact"
              emphasis="quiet"
              label={paused ? t("provider.logs.resume") : t("provider.logs.pause")}
              onActivate={() => setPaused(!paused)}
            />
            <IconButton
              actionId="logs-refresh"
              iconId="refresh-cw"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              label={t("provider.logs.refresh")}
              onActivate={() => fetchLogs(true)}
            />
            <IconButton
              actionId="logs-export"
              iconId="download"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              label={t("provider.logs.exportVisible")}
              onActivate={handleExport}
            />
            <IconButton
              actionId="logs-clear"
              iconId="delete"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              tone="danger"
              label={t("provider.logs.clear")}
              onActivate={() => setEntries([])}
            />
          </>
        )}
      />

      <ClientMetaPanel />

      {/* Prototype .sk-log-toolbar grammar: pill level filters, a quiet preset,
          and the search field pinned to the right. The desktop surface keeps
          six multi-toggle levels instead of the prototype's four. */}
      <div className="sc-log-toolbar" data-log-filters>
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            className={`sc-log-filter is-${lvl}${levelFilters[lvl] ? " is-on" : ""}`}
            aria-pressed={levelFilters[lvl]}
            data-log-level={lvl}
            onClick={() => setLevelFilters((prev) => ({
              ...prev,
              [lvl]: !prev[lvl],
            }))}
          >
            {lvl.toUpperCase()}
          </button>
        ))}
        <Button
          actionId="logs-only-warnings"
          className="sc-log-preset"
          emphasis="quiet"
          density="compact"
          label={t("provider.logs.onlyWarnings")}
          onActivate={onlyWarningsAndAbove}
        />
        <TextField
          className="sc-log-filter-input"
          density="compact"
          clearable
          leading={<Icon iconId="search" size={12} />}
          placeholder={t("provider.logs.filterPlaceholder")}
          value={filterText}
          onValueChange={setFilterText}
        />
      </div>

      <div
        ref={(el) => {
          (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current =
            el;
          (
            containerRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = el;
        }}
        className="selectable sc-logs-console"
      >
        <div className="sc-log-head">
          <span>{t("provider.logs.colTime")}</span>
          <span>{t("provider.logs.colSource")}</span>
          <span>{t("provider.logs.colLevel")}</span>
          <span>{t("provider.logs.colMessage")}</span>
        </div>
        {filteredEntries.length === 0 ? (
          <Empty
            className="sc-logs-empty"
            description={t("provider.logs.noLogs")}
          />
        ) : (
          filteredEntries.map((e, i) => {
            const level = e.level ?? "info";
            const lineTone = level === "warn"
              ? "is-warn"
              : level === "error" || level === "fatal"
                ? "is-error"
                : "";
            return (
              <div key={i} className={`sc-log-line ${lineTone}`.trim()}>
                <span className="sc-log-line__time">{formatTime(e.time)}</span>
                <code className="sc-log-line__source">{e.subsystem ?? "—"}</code>
                <span className="sc-log-line__level">
                  <Tag tone={LEVEL_TONES[level]}>{level.toUpperCase()}</Tag>
                </span>
                <span className="sc-log-line__message">{e.message}</span>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>

      <div className="sc-logs-footer">
        <span className="sc-logs-footer__count">
          {t("provider.logs.showing", {
            filtered: filteredEntries.length,
            total: entries.length,
          })}
        </span>
        <label className="sc-logs-footer__follow">
          <span>{t("provider.logs.autoFollow")}</span>
          <Switch
            checked={autoFollow}
            aria-label={t("provider.logs.autoFollow")}
            onCheckedChange={setAutoFollow}
          />
        </label>
      </div>
    </SettingsContainer>
  );
}
