/**
 * TerminalDock — device-held shell sessions rendered inside the work area.
 *
 * Parity with production TerminalPanel: a shell tab strip (dead shells keep
 * their exit output until the tab closes), an add menu for a new shell or a
 * custom command, and a read-only output surface. The output itself is the
 * peers-ui TerminalSurface primitive — this dock owns no PTY and spawns no
 * process, it only feeds the seeded append-only line stream.
 */
import { useState } from 'react';
import {
  Button, Empty, Flex, Icon, IconButton, Popover, ScrollArea, TerminalSurface, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import { SEED_TERMINAL_SESSIONS, TERMINAL_PLACEMENT_ROOT } from '../workbench-data';
import type { TerminalSessionSeed, TerminalSessionStatus } from '../types';

let sessionSeq = 100;

function shellLabel(command: string): string {
  return command.split('/').filter(Boolean).pop() ?? command;
}

export function TerminalDock() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [sessions, setSessions] = useState<readonly TerminalSessionSeed[]>(SEED_TERMINAL_SESSIONS);
  const [activeId, setActiveId] = useState<string>(SEED_TERMINAL_SESSIONS[0].sessionId);
  const [customOpen, setCustomOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  const active = sessions.find(session => session.sessionId === activeId) ?? null;

  const addSession = (rawCommand: string, status: TerminalSessionStatus = 'running') => {
    const id = `term-${(sessionSeq += 1)}`;
    const session: TerminalSessionSeed = {
      sessionId: id,
      command: rawCommand,
      cwd: TERMINAL_PLACEMENT_ROOT,
      placement: 'desktop',
      status,
      lines: status === 'running'
        ? [{ id: `${id}-l1`, stream: 'system', text: `spawned · ${rawCommand}` }]
        : [{ id: `${id}-l1`, stream: 'system', text: `exited · ${rawCommand}` }],
    };
    setSessions(previous => [...previous, session]);
    setActiveId(id);
  };

  const startCustom = () => {
    const value = command.trim();
    if (!value) return;
    addSession([value, args.trim()].filter(Boolean).join(' '));
    setCommand('');
    setArgs('');
    setCustomOpen(false);
  };

  const kill = (sessionId: string) => {
    setSessions(previous => previous.map(session => (
      session.sessionId === sessionId
        ? {
          ...session,
          status: 'killed',
          lines: [...session.lines, { id: `${sessionId}-kill`, stream: 'system', text: t('agent.wb.terminal.killedLine') }],
        }
        : session
    )));
  };

  const close = (sessionId: string) => {
    setSessions((previous) => {
      const next = previous.filter(session => session.sessionId !== sessionId);
      if (sessionId === activeId) setActiveId(next[next.length - 1]?.sessionId ?? '');
      return next;
    });
  };

  const addMenu = (
    <div className="pa-pop-panel pa-wb-term__menu" data-pt-wb-terminal-menu>
      <Button actionId="wb.terminal.new-shell" emphasis="quiet" fullWidth
        label={t('agent.wb.terminal.newShell')}
        leading={<Icon iconId="plus" size={14} />}
        onActivate={() => { addSession('zsh'); setCustomOpen(false); }} />
      <Button actionId="wb.terminal.custom-toggle" emphasis="quiet" fullWidth
        label={t('agent.wb.terminal.customCommand')}
        leading={<Icon iconId="terminal" size={14} />}
        onActivate={() => setCustomOpen(open => !open)} />
      {customOpen && (
        <Flex direction="row" gap={6} className="pa-wb-term__custom">
          <TextField
            value={command}
            aria-label={t('agent.wb.terminal.command')}
            placeholder={t('agent.wb.terminal.command')}
            data-pt-wb-terminal-command
            onValueChange={setCommand}
            onEnter={startCustom}
          />
          <TextField
            value={args}
            aria-label={t('agent.wb.terminal.args')}
            placeholder={t('agent.wb.terminal.args')}
            data-pt-wb-terminal-args
            onValueChange={setArgs}
            onEnter={startCustom}
          />
          <Button actionId="wb.terminal.start" emphasis="primary" density="compact"
            label={t('agent.wb.terminal.start')} data-pt-wb-terminal-start
            availability={command.trim() ? undefined : { kind: 'disabled', reason: t('agent.wb.terminal.command') }}
            onActivate={startCustom} />
        </Flex>
      )}
    </div>
  );

  return (
    <div className="pa-wb-dock pa-wb-term" data-pt-wb-terminal-panel>
      <Flex direction="row" align="center" gap={2} className="pa-wb-term__strip">
        <ScrollArea className="pa-wb-term__tabs">
          {sessions.map(session => {
            const dead = session.status !== 'running';
            return (
              <Flex key={session.sessionId} direction="row" align="center"
                className="pa-wb-term__tab-wrap" data-pt-wb-terminal-session={session.sessionId}
                data-pt-wb-terminal-status={session.status}>
                <Button
                  actionId={`wb.terminal.tab.${session.sessionId}`}
                  emphasis="quiet"
                  density="compact"
                  className="pa-wb-term__tab"
                  aria-current={session.sessionId === activeId ? 'page' : undefined}
                  title={`${t(`agent.wb.terminal.placement.${session.placement}`)} · ${session.cwd}`}
                  onActivate={() => setActiveId(session.sessionId)}
                >
                  <span data-pt-wb-terminal-tab-name>{shellLabel(session.command)}</span>
                  {dead && (
                    <Icon
                      iconId="circle-slash"
                      size={12}
                      className="pa-wb-term__dead"
                      data-pt-wb-terminal-exit-mark
                    />
                  )}
                </Button>
                <IconButton
                  actionId={`wb.terminal.close.${session.sessionId}`}
                  iconId="close"
                  iconSize={12}
                  label={t('agent.common.cancel')}
                  emphasis="quiet"
                  density="compact"
                  data-pt-wb-terminal-close={session.sessionId}
                  onActivate={() => close(session.sessionId)}
                />
              </Flex>
            );
          })}
        </ScrollArea>
        <Popover label={t('agent.wb.terminal.newShell')} placement="bottom" content={addMenu}>
          <IconButton actionId="wb.terminal.add" iconId="plus" iconSize={14}
            label={t('agent.wb.terminal.newShell')} emphasis="quiet" density="compact"
            data-pt-wb-terminal-add />
        </Popover>
      </Flex>

      {active ? (
        <TerminalSurface
          className="pa-wb-term__surface"
          lines={active.lines}
          status={active.status}
          exitCode={active.exitCode}
          command={active.command}
          cwd={active.cwd}
          maxHeight="100%"
          runningLabel={t('agent.wb.terminal.running')}
          exitedLabel={t('agent.wb.terminal.exited')}
          killedLabel={t('agent.wb.terminal.killed')}
          unknownLabel={t('agent.wb.terminal.unknown')}
          exitLabel={t('agent.wb.terminal.exit')}
          emptyLabel={t('agent.wb.terminal.empty')}
          data-pt-wb-terminal-surface
          actions={active.status === 'running' ? (
            <IconButton actionId={`wb.terminal.kill.${active.sessionId}`} iconId="square"
              iconSize={13} label={t('agent.wb.terminal.kill')} emphasis="quiet" density="compact"
              tone="danger" onActivate={() => kill(active.sessionId)} />
          ) : undefined}
        />
      ) : (
        <div className="pa-wb-dock--centered" data-pt-wb-terminal-empty>
          <Empty description={t('agent.wb.terminal.noSession')} />
        </div>
      )}
      <Text tone="muted" className="pa-wb-term__placement">
        {t(`agent.wb.terminal.placement.${active?.placement ?? 'desktop'}`)} · {active?.cwd ?? TERMINAL_PLACEMENT_ROOT}
      </Text>
    </div>
  );
}
