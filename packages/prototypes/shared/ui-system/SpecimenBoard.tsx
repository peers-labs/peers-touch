/**
 * SpecimenBoard — 样本 tab.
 *
 * The training artifacts: every VETTED component (registry.ts) rendered in its
 * reviewed state matrix under the north-star candidate theme, driven by one
 * shared condition switch (标准 / 长文案 / 禁用). A component earns vetted
 * status only after its specimen is reviewed here AND a prototype consumes it.
 * Boards never invent components that do not exist in @peers-touch/ui.
 */
import { useState, type ReactNode } from 'react';
import {
  Alert, Avatar, AvatarGroup, Button, Checkbox, CopyButton, Dialog, Empty, Field, Icon,
  IconButton, Menu, Popover, QrCode, Segmented, Select, Switch, Tag, TextArea,
  TextField, Toggle,
} from '@peers-touch/ui';
import { CAPABILITIES } from './registry';

type Condition = 'normal' | 'long' | 'disabled';
const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'normal', label: '标准' },
  { value: 'long', label: '长文案' },
  { value: 'disabled', label: '禁用' },
];

function Card({ id, title, consumed, children }: { id: string; title: string; consumed: string[]; children: ReactNode }) {
  return (
    <article className="nb-card" data-specimen={id}>
      <header className="nb-card-head">
        <strong>{title}</strong>
        <code>{id}</code>
        <span className="nb-status" data-status="vetted">已验收</span>
      </header>
      <div className="nb-card-body">
        <div className="nb-card-stage" data-align={id === 'Alert' || id === 'Empty' || id === 'QrCode' ? 'start' : 'start'}>{children}</div>
        <div className="nb-consumed">
          {consumed.map(s => <span key={s} className="nb-cap-consumer">{s}</span>)}
        </div>
      </div>
    </article>
  );
}

export function SpecimenBoard({ condition }: { condition: Condition }) {
  const disabled = condition === 'disabled';
  const long = condition === 'long';
  const unavailable = disabled ? { kind: 'disabled' as const, reason: '禁用样本条件下此命令不可用' } : undefined;

  const [text, setText] = useState('林晚');
  const [area, setArea] = useState('周末把阳台的薄荷分了三盆，留一盆给自己。');
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState('all');
  const [choice, setChoice] = useState('warm');
  const [toggle, setToggle] = useState(false);
  const [check, setCheck] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [picked, setPicked] = useState('');

  const cap = (id: string) => CAPABILITIES.find(c => c.id === id);
  const consumers = (id: string) => cap(id)?.consumedBy ?? [];
  const l = (short: string, extra: string) => long ? `${short} · ${extra}` : short;

  return (
    <div className="nb-canvas" data-nb-specimens>
      <p className="nb-card-note" style={{ margin: 0 }}>
        每个样本用同一条件开关检验标准态、长文案与禁用态；只有已被原型真实消费的组件才有样本卡。
      </p>

      <div className="nb-grid">
        <Card id="Button" title="按钮" consumed={consumers('Button')}>
          <Button actionId="spec.primary" emphasis="primary" availability={unavailable}>
            {l('保存', '这是一个用于检查伸展与折行的较长主操作文案')}
          </Button>
          <Button actionId="spec.secondary" availability={unavailable}>次操作</Button>
          <Button actionId="spec.quiet" emphasis="quiet" tone="danger" availability={unavailable}>删除</Button>
        </Card>

        <Card id="IconButton" title="图标按钮" consumed={consumers('IconButton')}>
          <IconButton actionId="spec.icon.search" iconId="search" label="搜索" emphasis="secondary" />
          <IconButton actionId="spec.icon.plus" iconId="plus" label="新建" emphasis="quiet" />
          <IconButton actionId="spec.icon.delete" iconId="delete" label="删除" tone="danger" availability={unavailable} />
        </Card>

        <Card id="TextField" title="单行输入" consumed={consumers('TextField')}>
          <TextField
            value={text} onChange={e => setText(e.target.value)} disabled={disabled} clearable onClear={() => setText('')}
            leading={<Icon iconId="users" size={15} />}
            placeholder={l('显示名称', '请输入在联邦目录中展示的公开显示名称')}
            style={{ width: '100%' }} />
        </Card>

        <Card id="TextArea" title="多行输入" consumed={consumers('TextArea')}>
          <TextArea value={area} onChange={e => setArea(e.target.value)} disabled={disabled}
            characterCount maxLength={200} minimumRows={3} aria-label="动态正文" />
        </Card>

        <Card id="Switch" title="开关" consumed={consumers('Switch')}>
          <Switch checked={on} onCheckedChange={setOn} disabled={disabled}
            label={l('消息通知', '在联邦连接与本机通道上同时开启提及提醒')} />
        </Card>

        <Card id="Checkbox" title="复选" consumed={consumers('Checkbox')}>
          <Checkbox checked={check} onCheckedChange={setCheck} disabled={disabled}
            label={l('同时通知管理员', '跨站点广播给所有具备管理权限的设备成员')} />
          <Checkbox indeterminate checked={false} disabled label="部分子项已选" />
        </Card>

        <Card id="Segmented" title="分段选择" consumed={consumers('Segmented')}>
          <Segmented value={seg} onValueChange={setSeg} options={[
            { value: 'all', label: l('全部', '全部动态') },
            { value: 'circle', label: '生活圈' },
            { value: 'following', label: '关注' },
          ]} />
        </Card>

        <Card id="Select" title="下拉选择" consumed={consumers('Select')}>
          <Select label="主题" value={choice} searchable disabled={disabled}
            onValueChange={v => setChoice(typeof v === 'string' ? v : (v?.[0] ?? 'warm'))}
            options={[
              { value: 'warm', label: '暖纸' },
              { value: 'glass', label: '松绿玻璃' },
              { value: 'night', label: '夜航（禁用示例）', availability: { kind: 'disabled', reason: '尚未发布' } },
            ]} />
        </Card>

        <Card id="Toggle" title="可选中动作" consumed={consumers('Toggle')}>
          <Toggle actionId="spec.toggle" selected={toggle} onSelectedChange={setToggle}
            availability={unavailable}>{toggle ? '已收藏' : '收藏'}</Toggle>
        </Card>

        <Card id="Field" title="字段框" consumed={consumers('Field')}>
          <Field label="显示名称" description="对外可见的名字" required style={{ width: '100%' }}>
            <TextField defaultValue="林晚" disabled={disabled} placeholder="显示名称" />
          </Field>
        </Card>

        <Card id="Tag" title="状态标签" consumed={consumers('Tag')}>
          <Tag tone="info">联邦</Tag>
          <Tag tone="success">已验证</Tag>
          <Tag tone="warning">待确认</Tag>
          <Tag onDismiss={() => undefined} dismissLabel="移除">可移除</Tag>
        </Card>

        <Card id="Alert" title="提示条" consumed={consumers('Alert')}>
          <Alert tone="warning" title={l('联系人身份尚未确认', '在完成带外身份核验之前，跨站私密内容共享保持关闭')}
            description="确认之前不能共享私密文档。" />
        </Card>

        <Card id="Empty" title="空状态" consumed={consumers('Empty')}>
          <Empty description={long ? '还没有任何跨站动态，建立第一个可信连接后内容会出现在这里。' : '还没有动态'}
            action={<Button actionId="spec.empty" emphasis="secondary" availability={unavailable}>写第一条</Button>} />
        </Card>

        <Card id="Avatar" title="头像与头像组" consumed={consumers('Avatar')}>
          <Avatar name="林晚" size={48} background="#c98a5a" />
          <Avatar name="陈屿" size={36} background="#3f6550" />
        </Card>

        <Card id="AvatarGroup" title="头像组" consumed={consumers('AvatarGroup')}>
          <AvatarGroup>
            <Avatar name="周禾" size={32} background="#5f7d5a" />
            <Avatar name="苏禾" size={32} background="#5d5a44" />
            <Avatar size={32} fallback="+3" />
          </AvatarGroup>
        </Card>

        <Card id="Dialog" title="模态对话框" consumed={consumers('Dialog')}>
          <Button actionId="spec.dialog.open" emphasis="primary" availability={unavailable} onActivate={() => setDialog(true)}>打开对话框</Button>
          <Dialog open={dialog} title="加入联邦" description="输入对端站公开地址。" onDismiss={() => setDialog(false)}
            footer={<>
              <Button actionId="spec.dialog.cancel" onActivate={() => setDialog(false)}>取消</Button>
              <Button actionId="spec.dialog.ok" emphasis="primary" onActivate={() => setDialog(false)}>建立连接</Button>
            </>}>
            <TextField defaultValue="https://" aria-label="站点地址" />
          </Dialog>
        </Card>

        <Card id="Popover" title="弹出层" consumed={consumers('Popover')}>
          <Popover label="快速反应" content={<>
            <Button actionId="spec.pop.like" emphasis="quiet" onActivate={() => setPicked('赞')}>赞</Button>
            <Button actionId="spec.pop.save" emphasis="quiet" onActivate={() => setPicked('收藏')}>收藏</Button>
          </>}>
            <Button actionId="spec.pop.trigger" emphasis="secondary" availability={unavailable}>
              {picked ? `已选：${picked}` : '快速反应'}
            </Button>
          </Popover>
        </Card>

        <Card id="Menu" title="菜单" consumed={consumers('Menu')}>
          <Menu actions={[
            { id: 'spec.menu.copy', label: '复制链接', onActivate: () => setPicked('复制链接') },
            { id: 'spec.menu.sep', label: '危险', kind: 'separator' },
            { id: 'spec.menu.block', label: '屏蔽该站点', tone: 'danger', onActivate: () => setPicked('屏蔽') },
          ]}>
            <Button actionId="spec.menu.trigger" emphasis="secondary"
              trailing={<Icon iconId="chevron-down" size={15} />} availability={unavailable}>更多操作</Button>
          </Menu>
        </Card>

        <Card id="CopyButton" title="复制按钮" consumed={consumers('CopyButton')}>
          <CopyButton actionId="spec.copy" text="ptid:linwan:3f9a" label={l('复制 PTID', '复制这串较长的联邦身份标识到剪贴板')}
            copiedLabel="已复制" availability={unavailable} />
        </Card>

        <Card id="QrCode" title="二维码" consumed={consumers('QrCode')}>
          <QrCode value="peers://approve/device/4f2a" size={132} label="设备关联二维码" />
        </Card>
      </div>
    </div>
  );
}

export { CONDITIONS };
export type { Condition };
