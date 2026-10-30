/**
 * ButtonContractSpecimen — ui.spec.button contract-bound exemplar.
 *
 * Framework path (not a visual one-off):
 *   specs/action.md#ui.spec.button + button-spec.md (B01–B20)
 *     → packages/ui/web actions.tsx / overlays.tsx (real primitives)
 *     → these stable, case-id-bound specimens with a LOCAL owner mock.
 *
 * The mock models only the command projection the component consumes
 * (availability + execution: idle→pending→succeeded/failed→recovering) and
 * single-flight. It is NOT a business success: real send / permission / delete
 * outcomes stay UNPROVEN until a product Journey owns them.
 *
 * Stable case ids match the spec anchors (B01..B20) so L2/L3 evidence and the
 * capability index can reference them without guessing.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActionGroup, Button, ConfirmAction, CopyButton, Flex, IconButton,
  Icon, Paragraph, SplitButton, Text, Toggle,
  type ActionExecution, type MenuAction,
} from '@peers-touch/ui';

type Condition = 'normal' | 'long' | 'disabled';

interface CommandMock {
  phase: ActionExecution;
  attempts: number;
  intents: number;
  run: () => void;
  retry: () => void;
  reset: () => void;
}

/** Local owner projection. The component already blocks activation while
 *  pending/recovering (single-flight in semantics); the mock also proves the
 *  label/width contract and that a failed run keeps its draft. State is held
 *  in refs so the React state updaters stay pure (StrictMode-safe). */
function useCommandMock(options: { failFirst?: boolean; delay?: number } = {}): CommandMock {
  const { failFirst = false, delay = 650 } = options;
  const [phase, setPhase] = useState<ActionExecution>('idle');
  const [attempts, setAttempts] = useState(0);
  const [intents, setIntents] = useState(0);
  const phaseRef = useRef<ActionExecution>('idle');
  const attemptRef = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const schedule = useCallback((nextAttempt: number, recovering: boolean) => {
    setPhase(recovering ? 'recovering' : 'pending');
    phaseRef.current = recovering ? 'recovering' : 'pending';
    const t = window.setTimeout(() => {
      const failedNow = failFirst && nextAttempt === 1 && !recovering;
      phaseRef.current = failedNow ? 'failed' : 'succeeded';
      setPhase(phaseRef.current);
    }, delay);
    timers.current.push(t);
  }, [failFirst, delay]);

  const run = useCallback(() => {
    if (phaseRef.current === 'pending' || phaseRef.current === 'recovering') return;
    attemptRef.current += 1;
    const next = attemptRef.current;
    setAttempts(next);
    setIntents(value => value + 1);
    schedule(next, false);
  }, [schedule]);

  const retry = useCallback(() => {
    attemptRef.current += 1;
    const next = attemptRef.current;
    setAttempts(next);
    setIntents(value => value + 1);
    schedule(next, true);
  }, [schedule]);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    attemptRef.current = 0;
    phaseRef.current = 'idle';
    setPhase('idle'); setAttempts(0);
  }, []);

  return { phase, attempts, intents, run, retry, reset };
}

function Case({ id, title, contract, children }: {
  id: string; title: string; contract: string; children: React.ReactNode;
}) {
  return (
    <section data-spec-case={id} className="bc-case">
      <header className="bc-case-head">
        <Text strong>{title}</Text>
        <code className="bc-case-id">{id}</code>
      </header>
      <Paragraph tone="secondary" className="bc-case-contract">{contract}</Paragraph>
      <div className="bc-case-stage">{children}</div>
    </section>
  );
}

const executionLabel: Partial<Record<ActionExecution, string>> = {
  pending: '正在保存', recovering: '恢复中', succeeded: '已保存', failed: '保存失败',
};

export function ButtonContractSpecimen({ condition }: { condition: Condition }) {
  const long = condition === 'long';
  const forceDisabled = condition === 'disabled'
    ? { kind: 'disabled' as const, reason: long ? '当前样本处于禁用条件，请切回标准以激活这条较长的解释原因文本' : '当前为禁用样本' }
    : undefined;

  // B01 save (succeeds); draft retained across the interaction.
  const save = useCommandMock();
  const [draft, setDraft] = useState('每周四晚上的共享书架轮值');

  // B06 retry: first attempt fails, retry binds the same intent and recovers.
  const redeliver = useCommandMock({ failFirst: true });

  // B03 stop generation: running -> stopping -> stopped (not "completed").
  const [runPhase, setRunPhase] = useState<'idle' | 'stopping' | 'stopped'>('idle');
  const stopTimers = useRef<number[]>([]);
  useEffect(() => () => stopTimers.current.forEach(clearTimeout), []);
  const stop = () => {
    if (runPhase !== 'idle') return;
    setRunPhase('stopping');
    stopTimers.current.push(window.setTimeout(() => setRunPhase('stopped'), 600));
  };

  // B12/B19 permission unavailable-with-reason, with a real recovery path.
  const [stationConnected, setStationConnected] = useState(false);

  // B11 split button: default action vs alternatives must be independently observable.
  const [defaultSends, setDefaultSends] = useState(0);
  const [alternativePicks, setAlternativePicks] = useState<string[]>([]);
  const sendAlternatives = useMemo<MenuAction[]>(() => [
    { id: 'send-scheduled', label: '定时发送', onActivate: () => setAlternativePicks(p => [...p, 'scheduled']) },
    { id: 'send-draft', label: '存为草稿', onActivate: () => setAlternativePicks(p => [...p, 'draft']) },
  ], []);

  return (
    <Flex gap="var(--pt-space-lg)" className="bc-specimen">
      <Text className="fs-notice" tone="secondary" role="status">
        标本绑定 ui.spec.button；动作为本地 owner mock，只证明控件合同（状态投影/单发/失败保留/焦点），
        不证明真实发送、授权或删除结果（UNPROVEN）。长文案/禁用由顶部条件切换。
      </Text>

      <Case id="B01-B08-B17" title="层级、密度与宽度" contract="emphasis primary/secondary/quiet/inline；density 三档；fill 占满行尾轨道；一个表面只有一个主承诺。">
        <Flex direction="row" gap="var(--pt-space-sm)" wrap="wrap">
          <Button actionId="bc.save" emphasis="primary" leading={<Icon iconId="save" size={15} />}
            availability={forceDisabled}>{long ? '保存这些较长的书架轮值设置' : '保存'}</Button>
          <Button actionId="bc.add" leading={<Icon iconId="plus" size={15} />}
            availability={forceDisabled}>{long ? '添加一位协作成员到本轮轮值' : '添加成员'}</Button>
          <Button actionId="bc.quiet" emphasis="quiet" availability={forceDisabled}>次要安静操作</Button>
          <Button actionId="bc.inline" emphasis="inline" availability={forceDisabled}>查看目标</Button>
          <IconButton actionId="bc.clear" iconId="close" label="清空搜索" emphasis="quiet"
            availability={forceDisabled} />
        </Flex>
        <Flex direction="row" gap="var(--pt-space-xs)" wrap="wrap">
          <Button actionId="bc.d.compact" density="compact">compact 28</Button>
          <Button actionId="bc.d.normal" density="normal">normal 36</Button>
          <Button actionId="bc.d.comfortable" density="comfortable">comfortable 44</Button>
          <Button actionId="bc.fill" emphasis="primary" fullWidth availability={forceDisabled}>
            {long ? '占满整行轨道的主要承诺按钮，文案可扩展但不把相邻动作挤错位' : 'fill 主操作'}
          </Button>
        </Flex>
      </Case>

      <Case id="B01" title="保存配置 · 成功投影" contract="primary；提交 dirty 字段；pending 不换宽、单发；成功只在 owner 确认后呈现；失败不清空表单。">
        <Flex gap="var(--pt-space-xs)">
          <input
            aria-label="配置草稿"
            className="bc-draft"
            value={draft}
            onChange={event => { setDraft(event.target.value); save.reset(); }}
          />
          <ActionGroup label="保存配置动作">
            <Button actionId="bc.save.run" emphasis="primary" leading={<Icon iconId="save" size={15} />}
              execution={save.phase} executionLabel="正在保存"
              availability={forceDisabled} onActivate={save.run}>
              {save.phase === 'idle' ? '保存' : (executionLabel[save.phase] ?? '保存')}
            </Button>
            <Button actionId="bc.save.reset" emphasis="quiet" onActivate={save.reset}>复位</Button>
          </ActionGroup>
        </Flex>
        <Text className="fs-notice" tone="secondary" role="status">
          phase={save.phase} · attempts={save.attempts} · 激活计数={save.intents}（连点只产生一次 owner 投影）·
          草稿保留：{draft}
        </Text>
      </Case>

      <Case id="B06" title="重试失败 · 绑定同一意图" contract="首次失败保留对象与失败原因；recovering 沿用原意图，不新建重复业务对象；成功由 owner 投影。">
        <ActionGroup label="重试动作">
          <Button actionId="bc.redeliver.run" leading={<Icon iconId="send" size={15} />}
            execution={redeliver.phase === 'failed' ? 'idle' : redeliver.phase}
            tone={redeliver.phase === 'failed' ? 'danger' : 'neutral'}
            onActivate={redeliver.run}>发送消息</Button>
          {redeliver.phase === 'failed' && (
            <Button actionId="bc.redeliver.retry" emphasis="secondary"
              leading={<Icon iconId="rotate-ccw" size={15} />} onActivate={redeliver.retry}>重试发送</Button>
          )}
        </ActionGroup>
        <Text className="fs-notice" tone={redeliver.phase === 'failed' ? 'danger' : 'secondary'} role="status">
          {redeliver.phase === 'failed'
            ? '发送失败，正文与附件保留；点“重试发送”走恢复投影。'
            : `phase=${redeliver.phase} · attempts=${redeliver.attempts}`}
        </Text>
      </Case>

      <Case id="B03-B04" title="停止生成 与 取消（两个不同 action）" contract="停止当前流 running→stopping→stopped，不等于任务完成；取消是另一条 action id。">
        <ActionGroup label="运行控制">
          <Button actionId="bc.stop" emphasis="secondary" leading={<Icon iconId="square" size={14} />}
            execution={runPhase === 'stopping' ? 'pending' : 'idle'}
            onActivate={stop}>{runPhase === 'stopped' ? '已停止' : '停止生成'}</Button>
          <Button actionId="bc.cancel" emphasis="quiet"
            availability={runPhase === 'stopping' ? { kind: 'disabled', reason: '正在请求停止' } : undefined}>
            <Icon iconId="ban" size={15} /> 取消任务
          </Button>
        </ActionGroup>
        <Text className="fs-notice" tone="secondary" role="status">stop phase={runPhase}（已生成内容保留，可重试）</Text>
      </Case>

      <Case id="B05" title="删除对象 · 上下文安静动作 + 确认面主危险" contract="对象上下文 quiet/danger；不可逆删除进确认面，确认按钮 primary/danger，具名范围。">
        <Flex direction="row" gap="var(--pt-space-sm)" wrap="wrap">
          <Button actionId="bc.delete.quiet" tone="danger" emphasis="quiet"
            leading={<Icon iconId="delete" size={15} />}>删除会话</Button>
          <ConfirmAction
            actionId="bc.delete.confirm"
            title="删除会话"
            description="将删除会话「项目讨论」及其本地副本，此操作不可撤销。"
            confirmLabel="删除会话「项目讨论」"
            cancelLabel="取消"
            onConfirm={() => undefined}>
            <Button actionId="bc.delete.open" tone="danger" emphasis="secondary"
              leading={<Icon iconId="delete" size={15} />}>永久删除…</Button>
          </ConfirmAction>
        </Flex>
      </Case>

      <Case id="B07" title="复制内容 · 短暂成功不改永久含义" contract="Clipboard 成功才显示 succeeded；复制为短暂反馈，timer 卸载清理。">
        <CopyButton actionId="bc.copy" text="group.design-review" label="复制消息" copiedLabel="已复制" />
      </Case>

      <Case id="B11" title="SplitButton · 默认动作 + 同意图变体" contract="主区直接提交默认动作；菜单区只展开变体，两触发区同轮廓、互不代发。">
        <SplitButton actionId="bc.send" label="发送" onActivate={() => setDefaultSends(n => n + 1)}
          alternativesLabel="选择发送方式" alternatives={sendAlternatives} />
        <Text className="fs-notice" tone="secondary" role="status" data-split-observer>
          默认发送={defaultSends} · 变体选择={alternativePicks.join(',') || '无'}
        </Text>
      </Case>

      <Case id="B14" title="持久选择不属于 Button" contract="可保持的开/关用 aria-pressed（Toggle），不伪装成一次提交命令。">
        <Toggle actionId="bc.star" label="收藏" emphasis="quiet"
          leading={<Icon iconId="star" size={15} />} selected={false}
          onSelectedChange={() => undefined} />
      </Case>

      <Case id="B12-B19" title="不可用但需要解释 · 可恢复路径" contract="禁用原因必须有键盘/读屏可读路径，不能只藏在不可聚焦 disabled 的 tooltip；提供恢复动作。">
        <ActionGroup label="权限动作">
          <Button actionId="bc.permission.grant" emphasis="primary"
            leading={<Icon iconId="shield-check" size={15} />}
            availability={stationConnected ? undefined : { kind: 'disabled', reason: '需要先连接 Station 才能授权文件读取' }}>
            允许此次读取所选文件
          </Button>
          {!stationConnected && (
            <Button actionId="bc.permission.connect" emphasis="secondary" onActivate={() => setStationConnected(true)}>
              连接 Station
            </Button>
          )}
        </ActionGroup>
        {!stationConnected && (
          <Text className="fs-notice" tone="warning" role="status">原因（旁路线性可读，不仅靠 tooltip）：需要先连接 Station 才能授权文件读取。</Text>
        )}
      </Case>

      <Case id="B-anti" title="拒绝例（不采用，仅对照）" contract="合同明确禁止；此处只静态陈列，不作为推荐用法。">
        <div className="bc-anti" data-negative-examples>
          <div className="bc-anti-row"><span className="bc-anti-x" aria-hidden="true">✕</span>
            <Button actionId="bc.anti.primary1" emphasis="primary" availability={{ kind: 'disabled', reason: '反例：同一表面两个无关 primary' }}>主操作 A</Button>
            <Button actionId="bc.anti.primary2" emphasis="primary" availability={{ kind: 'disabled', reason: '反例：同一表面两个无关 primary' }}>主操作 B</Button>
          </div>
          <Text className="fs-notice" tone="secondary">未具名 IconButton（无 label）在 IconButton 内直接 throw，不渲染；圆形/胶囊 icon 不在产品语言内；Button 不接受 href 与 action 混合。</Text>
        </div>
      </Case>
    </Flex>
  );
}
