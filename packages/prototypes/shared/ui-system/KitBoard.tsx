/**
 * KitBoard — 套件 tab.
 *
 * Product-task PATTERN KITS: real @peers-touch/ui components composed for one
 * job in the Peers domain (neighbor / station / moment), with real local
 * state. Kits sit above 样本 (single-component state matrices) and below the
 * prototypes (full surfaces). A kit proves the library can carry a recurring
 * interaction before the prototype is allowed to hand-roll it.
 *
 * Shape grammar: each kit is one card on the recessed canvas; its composition
 * lives inside a bounded STAGE (never a full-width band with a sea of empty
 * space). Layout classes are page-owned `nb-kit-*` (no .pt-* restyle); the
 * kit only composes primitives through their public API.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActionGroup, Alert, Avatar, Badge, Button, Dialog, Empty, EmojiArtwork, Field,
  FileTypeGlyph, GroupAvatar, Icon, IconButton, List, ListItem, ListItemMeta, Menu,
  Pagination, Popover, Progress, QrCode, Segmented, Select, Switch, Tabs, Tag,
  TextArea, TextField, ToastHost, Tooltip, createToastChannel,
} from '@peers-touch/ui';

function Kit({ id, index, title, sub, wide, stageClassName, children }: {
  id: string; index: string; title: string; sub: string; wide?: boolean;
  stageClassName?: string; children: ReactNode;
}) {
  return (
    <article className={`nb-kit-card${wide ? ' is-wide' : ''}`} data-kit={id}>
      <header className="nb-kit-head">
        <span className="nb-kit-index">{index}</span>
        <div className="nb-kit-titles">
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </header>
      <div className={`nb-kit-stage${stageClassName ? ` ${stageClassName}` : ''}`}>{children}</div>
    </article>
  );
}

// Identity tiles follow the pine-on-neutral discipline: others are ink.
const neighbors = [
  { id: 'p-zhouhe', name: '周禾', desc: '共享书架轮值 · 本站', tone: '#3d434a' },
  { id: 'p-chenyu', name: '陈屿', desc: '风筝夜拍 · 本站', tone: '#3d434a' },
  { id: 'p-ayan', name: '阿砚', desc: '植物医院 · 松绿书屋站', tone: '#3d434a' },
];

export function KitBoard() {
  const channel = useMemo(() => createToastChannel(), []);
  const seq = useMemo(() => ({ n: 0 }), []);
  const notify = (message: string) => {
    seq.n += 1;
    channel.publish({ id: `k${seq.n}`, message, tone: 'success', duration: 2600 });
  };

  const [pinned, setPinned] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [reaction, setReaction] = useState('');
  const [alertOn, setAlertOn] = useState(true);
  const [progress, setProgress] = useState(42);

  const [note, setNote] = useState('');
  const [detail, setDetail] = useState('');
  const [scope, setScope] = useState('local');
  const [notifyMe, setNotifyMe] = useState(true);
  const [trust, setTrust] = useState('mutual');
  const [saved, setSaved] = useState('');

  const [tab, setTab] = useState('chats');
  const [page, setPage] = useState(1);

  return (
    <div className="nb-canvas nb-kits" data-nb-kits>
      <Kit id="action" index="01" title="动作套件"
        sub="一个对象上的主/次/安静/危险动作、图标动作组与复制，层级只靠 emphasis 与 tone。">
        <div className="nb-kit-stack">
          <div className="nb-kit-row">
            <Button actionId="kit.primary" emphasis="primary" onActivate={() => notify('已加入生活圈')}>加入生活圈</Button>
            <Button actionId="kit.secondary" onActivate={() => notify('已发送招呼')}>打个招呼</Button>
            <Button actionId="kit.quiet" emphasis="quiet">查看主页</Button>
            <Button actionId="kit.danger" emphasis="quiet" tone="danger" onActivate={() => setDialog(true)}>移除邻居</Button>
          </div>
          <ActionGroup label="邻居卡工具">
            <IconButton actionId="kit.pin" iconId={pinned ? 'check' : 'star'} label={pinned ? '取消置顶' : '置顶'}
              emphasis="quiet" aria-pressed={pinned} onActivate={() => setPinned(v => !v)} />
            <IconButton actionId="kit.mute" iconId={muted ? 'bell-off' : 'bell'} label={muted ? '取消免打扰' : '免打扰'}
              emphasis="secondary" aria-pressed={muted} onActivate={() => setMuted(v => !v)} />
            <IconButton actionId="kit.copy" iconId="copy" label="复制句柄"
              onActivate={() => notify('句柄已复制')} />
          </ActionGroup>
          <Dialog open={dialog} title="移除邻居？" description="彼此的会话记录保留在各自站点。" onDismiss={() => setDialog(false)}
            footer={<>
              <Button actionId="kit.remove.cancel" onActivate={() => setDialog(false)}>取消</Button>
              <Button actionId="kit.remove.ok" tone="danger" emphasis="primary"
                onActivate={() => { setDialog(false); notify('已移除邻居'); }}>移除</Button>
            </>} />
        </div>
      </Kit>

      <Kit id="form" index="02" title="表单套件"
        sub="Field 承载标签/描述/校验，TextField/TextArea/Switch/Segmented/Select 组合为一张邻居备注卡。">
        <form className="nb-kit-form" onSubmit={e => { e.preventDefault(); setSaved(note || '(空)'); notify('备注已保存'); }}>
          <Field label="备注名" description="只在你的站点可见">
            <TextField value={note} onChange={e => setNote(e.target.value)} placeholder="例如：书架轮值的周禾" clearable onClear={() => setNote('')} />
          </Field>
          <Field label="备注"><TextArea value={detail} onChange={e => setDetail(e.target.value)} minimumRows={2}
            aria-label="备注" placeholder="怎么认识的、共同的圈子、值得记住的事" /></Field>
          <Field label="信任范围">
            <Segmented value={trust} onValueChange={setTrust} options={[
              { value: 'mutual', label: '双向邻居' }, { value: 'follower', label: '单向关注' }, { value: 'blocked', label: '已拉黑' },
            ]} />
          </Field>
          <Field label="默认可见动态"><Select value={scope} onValueChange={v => setScope(String(v))}
            options={[{ value: 'local', label: '本站' }, { value: 'federated', label: '联邦可达' }]} /></Field>
          <Switch checked={notifyMe} onCheckedChange={setNotifyMe} label="对方发动态时提醒我" />
          <div className="nb-kit-row nb-kit-form-foot">
            <Button actionId="kit.form.save" behavior="submit" emphasis="primary">保存备注</Button>
            {saved && <span className="nb-kit-saved" role="status">已保存：{saved}</span>}
          </div>
        </form>
      </Kit>

      <Kit id="overlay" index="03" title="浮层套件" stageClassName="nb-kit-stage-overlay"
        sub="Tooltip 解释、Popover 轻动作、Menu 多动作、Dialog 破坏性确认；焦点陷阱与 Esc 由库统一。">
        <div className="nb-kit-row">
          <Tooltip label="两跳外 · 经周禾可达" placement="top">
            <Button actionId="kit.tip" emphasis="secondary">信任路径</Button>
          </Tooltip>
          <Popover label="快速反应" content={<>
            <Button actionId="kit.react.like" emphasis="quiet" onActivate={() => setReaction('赞')}>赞</Button>
            <Button actionId="kit.react.wave" emphasis="quiet" onActivate={() => setReaction('招手')}>招手</Button>
          </>}>
            <Button actionId="kit.react" emphasis="secondary">快速反应{reaction ? ` · ${reaction}` : ''}</Button>
          </Popover>
          <Menu actions={[
            { id: 'kit.menu.profile', label: '查看主页', onActivate: () => notify('打开主页') },
            { id: 'kit.menu.silent', label: '消息免打扰', onActivate: () => notify('已免打扰') },
            { id: 'kit.menu.sep', label: '危险', kind: 'separator' },
            { id: 'kit.menu.block', label: '拉黑', tone: 'danger', onActivate: () => notify('已拉黑') },
          ]}>
            <Button actionId="kit.menu" emphasis="secondary" trailing={<Icon iconId="chevron-down" size={15} />}>更多</Button>
          </Menu>
        </div>
      </Kit>

      <Kit id="feedback" index="04" title="反馈套件"
        sub="非阻断 inline Alert、可推进 Progress、空状态与动作结果；Toast 走独立通道。">
        <div className="nb-kit-stack">
          {alertOn && <Alert tone="warning" variant="inline" title="跨站连接尚未验证" description="验证前联邦动态不会送达。"
            dismissLabel="关闭" onDismiss={() => setAlertOn(false)} />}
          <Progress value={progress} label={`书架同步 · ${progress}%`} />
          <div className="nb-kit-row">
            <Button actionId="kit.progress" emphasis="secondary" onActivate={() => setProgress(p => p >= 100 ? 0 : p + 14)}>推进 14%</Button>
            <Button actionId="kit.toast" onActivate={() => notify('已保存到本站点')}>触发轻提示</Button>
          </div>
          <Empty description="这个生活圈还没有动态" action={<Button actionId="kit.empty" emphasis="secondary" onActivate={() => notify('打开发布器')}>写第一条</Button>} />
        </div>
        <ToastHost channel={channel} />
      </Kit>

      <Kit id="list" index="05" title="列表套件"
        sub="Tabs 切作用域，List/ListItemMeta 承载人与会话，Tag/Badge 表达状态与未读。">
        <div className="nb-kit-list">
          <Tabs value={tab} onValueChange={setTab} items={[
            { id: 'chats', label: '会话', content: <List items={neighbors} itemKey={n => n.id}
              renderItem={n => <ListItem actions={<Button actionId={`kit.open.${n.id}`} emphasis="quiet" density="compact">打开</Button>}>
                <ListItemMeta avatar={<Avatar name={n.name} size={34} background={n.tone} />}
                  title={<span className="nb-kit-person">{n.name}
                    {n.id === 'p-ayan' && <Tag tone="info">联邦</Tag>}</span>}
                  description={<span>{n.desc}</span>} />
              </ListItem>} /> },
            { id: 'requests', label: '邻居请求', content: <div className="nb-kit-request">
              <Badge count={1} label="1 条待入站"><Tag tone="warning">待处理</Tag></Badge>
              <p>阿砚 想加入小区生活圈</p>
            </div> },
          ]} />
          <div className="nb-kit-pager">
            <Pagination page={page} total={84} pageSize={20} onPageChange={setPage}
              previousLabel="上一页" nextLabel="下一页" />
          </div>
        </div>
      </Kit>

      <Kit id="identity" index="06" title="身份与媒体套件"
        sub="身份色字头像、组头像、二维码、表情艺术字与文件类型标，全部走语义资产。">
        <div className="nb-kit-row nb-kit-identity">
          <Avatar name="林" size={44} background="#2f6a50" />
          <Avatar name="陈" size={36} background="#3d434a" />
          <GroupAvatar name="小区生活群" size={40} members={[
            { id: '1', name: '周禾' }, { id: '2', name: '苏禾' }, { id: '3', name: '林晚' },
          ]} />
          <span className="nb-kit-identity-sep" />
          <EmojiArtwork emoji="🌿" label="植物" />
          <FileTypeGlyph mimeType="application/pdf" filename="书架公约.pdf" size={24} />
          <QrCode value="peers://approve/device/4f2a" size={92} label="设备关联二维码" />
        </div>
      </Kit>
    </div>
  );
}
