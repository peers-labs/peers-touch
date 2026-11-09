// Source-contract: the diagnostics LogsTab follows the north-star prototype
// LogsSection usage grammar — SettingsPanelHeader chrome, pill level filters
// (.sk-log-filter), a right-pinned search field, and a hairline grid table
// (.sk-log-table). Desktop keeps its functional superset (six multi-toggle
// levels, tail controls, auto-follow).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const logsSource = readFileSync(
  new URL('../LogsTab.tsx', import.meta.url),
  'utf8',
);
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');

const logsCss = northstarCss.slice(
  northstarCss.indexOf('.sc-logs-title-icon'),
  northstarCss.indexOf('/* MCP settings panel. */'),
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match only the selector's own rule (preceded by a closing brace) so
  // combined selector lists (.sc-log-head, .sc-log-line { … }) do not shadow
  // the standalone rule. No ^ anchor: it would match continuation lines.
  return logsCss.match(
    new RegExp(`\\}\\s*${escaped}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? '';
}

describe('logs surface header (prototype section grammar)', () => {
  it('uses SettingsPanelHeader instead of an ad-hoc Flex/Text title row', () => {
    expect(logsSource).toContain('SettingsPanelHeader');
    expect(logsSource).not.toContain('<Text ');
    expect(logsSource).not.toContain('<Flex');
  });

  it('keeps the four tail actions as quiet header icon buttons', () => {
    ['logs-toggle-pause', 'logs-refresh', 'logs-export', 'logs-clear'].forEach((id) => {
      expect(logsSource).toContain(`actionId="${id}"`);
    });
    const headerSlice = logsSource.slice(
      logsSource.indexOf('<SettingsPanelHeader'),
      logsSource.indexOf('/>', logsSource.indexOf('subtitle=')),
    );
    expect(headerSlice).toContain('emphasis="quiet"');
  });
});

describe('level filter pills (prototype .sk-log-filter)', () => {
  it('renders native multi-toggle pills for all six levels, not Checkbox+Tag rows', () => {
    expect(logsSource).not.toContain('Checkbox');
    expect(logsSource).toContain('className={`sc-log-filter is-${lvl}${levelFilters[lvl] ? " is-on" : ""}`}');
    expect(logsSource).toContain('aria-pressed={levelFilters[lvl]}');
    expect(logsSource).toContain('data-log-level={lvl}');
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach((level) => {
      expect(logsSource).toContain(`"${level}"`);
    });
  });

  it('paints the prototype pill chrome on tokens', () => {
    const pill = rule('.sc-log-filter');
    expect(pill).toContain('border-radius: 999px');
    expect(pill).toContain('padding: 3px 11px');
    expect(pill).toContain('font-size: 11px');
    expect(pill).toContain('font-weight: 600');
    expect(pill).toContain('letter-spacing: 0.04em');
    expect(pill).toContain('background: var(--pt-subtle)');
    expect(rule('.sc-log-filter.is-on')).toContain('background: var(--pt-primary)');
    expect(rule('.sc-log-filter.is-on')).toContain('color: var(--pt-onPrimary)');
    expect(rule('.sc-log-filter.is-on.is-warn')).toContain('var(--pt-warning)');
    const errorOn = logsCss.match(
      /\.sc-log-filter\.is-on\.is-error,[\s\S]*?\.sc-log-filter\.is-on\.is-fatal\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(errorOn).toContain('var(--pt-danger)');
  });

  it('pins the search field to the right of the toolbar', () => {
    expect(logsSource).toContain('className="sc-log-filter-input"');
    expect(rule('.sc-log-toolbar .sc-log-filter-input')).toContain('margin-left: auto');
  });
});

describe('log table (prototype .sk-log-table grid grammar)', () => {
  it('renders a four-column grid head and matching rows with hairline separators', () => {
    expect(logsSource).toContain('className="sc-log-head"');
    expect(logsSource).toContain('className={`sc-log-line ${lineTone}`.trim()}');
    const grid = logsCss.match(/\.sc-log-head,\s*\.sc-log-line\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(grid).toContain(
      'grid-template-columns: 76px 130px 56px minmax(0, 1fr)',
    );
    expect(rule('.sc-log-line')).toContain(
      'border-top: 1px solid color-mix(in srgb, var(--pt-text) 6%, transparent)',
    );
    expect(rule('.sc-log-head')).toContain('background: var(--pt-subtle)');
  });

  it('tones warn/error rows with semantic tokens and keeps the source in monospace', () => {
    expect(logsSource).toContain('"is-warn"');
    expect(rule('.sc-log-line.is-warn')).toContain('var(--pt-warning)');
    expect(rule('.sc-log-line.is-error')).toContain('var(--pt-danger)');
    expect(rule('.sc-log-line__source')).toContain('ui-monospace, Menlo, monospace');
  });

  it('keeps the logs CSS block free of hardcoded colors', () => {
    expect(logsCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(logsCss).not.toContain('SFMono-Regular');
  });
});

describe('functional superset retained', () => {
  it('keeps the warning preset, footer count and auto-follow switch', () => {
    expect(logsSource).toContain('actionId="logs-only-warnings"');
    expect(logsSource).toContain('className="sc-logs-footer"');
    expect(logsSource).toContain('<Switch');
  });
});
