import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, Switch, theme, Typography, Space, Empty, Tag, Checkbox } from 'antd';
import { RefreshCw, Download, Pause, Play, Search, FileText, Trash2 } from 'lucide-react';
import { api } from '../services/api';

const { Text, Title } = Typography;

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  information: 'info',
  warn: 'warn',
  warning: 'warn',
  err: 'error',
  error: 'error',
  fatal: 'fatal',
  panic: 'fatal',
};

interface LogEntry {
  raw: string;
  time?: string;
  level?: LogLevel;
  subsystem?: string;
  message: string;
}

function unescapeLogfmt(s: string): string {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
}

function extractLogfmtField(line: string, field: string): string | undefined {
    const re = new RegExp(field + '="((?:[^"\\\\]|\\\\.)*)"');
    const m = line.match(re);
    if (m) return unescapeLogfmt(m[1]);
    const reSimple = new RegExp(field + '=([^ ]+)');
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

    // Try JSON
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const obj = JSON.parse(trimmed);
            const meta = obj._meta || {};
            let msg = obj.msg || obj.message || (typeof obj['1'] === 'string' ? obj['1'] : (typeof obj['0'] === 'string' ? obj['0'] : line));
            if (obj.req) msg += ' | req=' + obj.req;
            if (obj.rsp) msg += ' | rsp=' + obj.rsp;
            return {
                raw: line,
                time: obj.time || meta.date,
                level: normalizeLevel(meta.logLevelName || meta.level || obj.level) || 'info',
                subsystem: obj.pkg || obj.subsystem || (typeof obj['0'] === 'string' && obj['0'].length < 50 ? obj['0'] : undefined),
                message: msg
            };
        } catch {
            // fallback to text parsing
        }
    }

    // Try Logfmt / TextFormatter
    const entry: LogEntry = { raw: line, message: line };
    
    const timeMatch = line.match(/time="([^"]+)"/);
    if (timeMatch) entry.time = timeMatch[1];
    
    const levelQuoted = extractLogfmtField(line, 'level');
    const levelSimple = line.match(/(?:^|\s)level=([^\s"]+)/)?.[1];
    entry.level = normalizeLevel(levelQuoted || levelSimple);

    const msgVal = extractLogfmtField(line, 'msg');
    if (msgVal) {
        entry.message = msgVal;
        const req = extractLogfmtField(line, 'req');
        const rsp = extractLogfmtField(line, 'rsp');
        if (req) entry.message += ' | req=' + req;
        if (rsp) entry.message += ' | rsp=' + rsp;
    }

    const pkgMatch = line.match(/pkg=([^ ]+)/);
    if (pkgMatch) entry.subsystem = pkgMatch[1];

    return entry;
}

export function LogsTab() {
  const { token } = theme.useToken();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<number>(-1);
  const [autoFollow, setAutoFollow] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>({
    trace: true, debug: true, info: true, warn: true, error: true, fatal: true
  });
  const [paused, setPaused] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<number>(-1);
  const loadingRef = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const mergeEntries = (prev: LogEntry[], incoming: LogEntry[]) => {
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
    return [...prev, ...incoming.slice(overlap)].slice(-2000);
  };

  const fetchLogs = useCallback(async (reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const currentCursor = reset ? -1 : cursorRef.current;
      const res = await api.tailLogs(currentCursor, 1000, 100 * 1024);
      const newEntries = (res.lines || []).map(parseLogLine);

      if (res.reset || reset) {
        setEntries(newEntries);
      } else if (newEntries.length > 0) {
        setEntries(prev => mergeEntries(prev, newEntries));
      }
      cursorRef.current = res.cursor;
      setCursor(res.cursor);
    } catch (err) {
      console.error(err);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (autoFollow && !paused && logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'auto' });
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
    return entries.filter(e => {
        const level = e.level || 'info';
        if (!levelFilters[level]) return false;
        if (!filterText) return true;
        const search = filterText.toLowerCase();
        return e.message.toLowerCase().includes(search) || 
               e.subsystem?.toLowerCase().includes(search) ||
               e.raw.toLowerCase().includes(search);
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
    const content = filteredEntries.map(e => e.raw).join('');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-box-${new Date().toISOString()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '';
    try {
        const d = new Date(timeStr);
        if (isNaN(d.getTime())) return timeStr;
        return d.toLocaleTimeString([], { hour12: false });
    } catch {
        return timeStr;
    }
  };

  const getLevelColor = (level?: LogLevel) => {
    switch (level) {
        case 'trace': return 'gray';
        case 'debug': return 'blue';
        case 'info': return 'green';
        case 'warn': return 'orange';
        case 'error': return 'red';
        case 'fatal': return 'magenta';
        default: return 'default';
    }
  };

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden', padding: 24 }} gap={16}>
        <Flexbox horizontal justify="space-between" align="center">
            <Flexbox gap={4}>
                <Flexbox horizontal align="center" gap={8}>
                    <FileText size={18} style={{ color: token.colorPrimary }} />
                    <Title level={5} style={{ margin: 0 }}>System Logs</Title>
                </Flexbox>
                <Text type="secondary" style={{ fontSize: 12 }}>Live tail of application logs (JSONL/Logfmt)</Text>
            </Flexbox>
            <Space>
                 <Input 
                    placeholder="Filter logs..." 
                    prefix={<Search size={14} />} 
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    style={{ width: 220 }}
                    allowClear
                 />
                 <Button 
                    icon={paused ? <Play size={14} /> : <Pause size={14} />} 
                    onClick={() => setPaused(!paused)}
                 >
                    {paused ? 'Resume' : 'Pause'}
                 </Button>
                 <Button icon={<RefreshCw size={14} />} onClick={() => fetchLogs(true)}>Refresh</Button>
                 <Button icon={<Download size={14} />} onClick={handleExport}>Export Visible</Button>
                 <Button icon={<Trash2 size={14} />} danger onClick={() => setEntries([])} />
            </Space>
        </Flexbox>

        <Flexbox horizontal gap={12} align="center">
            <Text style={{ fontSize: 12, marginRight: 8 }}>Levels:</Text>
            <Space wrap>
                {LEVELS.map(lvl => (
                    <Checkbox 
                        key={lvl} 
                        checked={levelFilters[lvl]} 
                        onChange={e => setLevelFilters(prev => ({...prev, [lvl]: e.target.checked}))}
                    >
                        <Tag color={getLevelColor(lvl)} style={{ fontSize: 10, margin: 0 }}>{lvl.toUpperCase()}</Tag>
                    </Checkbox>
                ))}
            </Space>
            <Button size="small" onClick={onlyWarningsAndAbove}>
              Only Warnings+
            </Button>
        </Flexbox>

        <div 
            ref={scrollRef}
            style={{ 
                flex: 1, 
                background: '#1a1a1a', 
                color: '#ececec', 
                borderRadius: 8, 
                padding: '8px 0', 
                overflow: 'auto',
                fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                fontSize: 12,
                border: '1px solid #333'
            }}
        >
            {filteredEntries.length === 0 ? (
                <Empty description={<span style={{color: '#666'}}>No logs found</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{marginTop: 40}} />
            ) : (
                filteredEntries.map((e, i) => (
                    <div key={i} style={{ 
                        padding: '2px 12px',
                        display: 'flex',
                        gap: 12,
                        borderBottom: '1px solid #252525',
                        alignItems: 'flex-start'
                    }}>
                        <Text style={{ color: '#666', minWidth: 70, flexShrink: 0 }}>{formatTime(e.time)}</Text>
                        <Tag color={getLevelColor(e.level)} style={{ 
                            fontSize: 9, 
                            minWidth: 45, 
                            textAlign: 'center', 
                            padding: '0 4px',
                            height: 16,
                            lineHeight: '14px',
                            flexShrink: 0,
                            marginTop: 1
                        }}>{(e.level || 'info').toUpperCase()}</Tag>
                        {e.subsystem && <Text style={{ color: '#aaa', minWidth: 80, flexShrink: 0 }}>[{e.subsystem}]</Text>}
                        <div style={{ flex: 1, wordBreak: 'break-all' }}>{e.message}</div>
                    </div>
                ))
            )}
            <div ref={logsEndRef} />
        </div>
        
        <Flexbox horizontal justify="space-between" align="center">
             <Text type="secondary" style={{ fontSize: 11 }}>
                Showing {filteredEntries.length} of {entries.length} entries.
             </Text>
             <Space size={16}>
                <Flexbox horizontal align="center" gap={8}>
                    <Text style={{ fontSize: 12 }}>Auto-follow</Text>
                    <Switch size="small" checked={autoFollow} onChange={setAutoFollow} />
                </Flexbox>
             </Space>
        </Flexbox>
    </Flexbox>
  );
}
