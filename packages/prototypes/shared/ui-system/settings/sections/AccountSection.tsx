/**
 * AccountSection — prototype counterpart of desktop AccountTab + DeviceLinkPanel.
 * Local profile state only: identity card with editable banner/avatar, stats,
 * copyable identity fields, public profile form, links, and a simulated device
 * link dialog (QR -> request -> comparison-code approval -> result).
 */
import { useRef, useState } from 'react';
import { Camera, Link2, Plus, Smartphone, Trash2 } from 'lucide-react';
import {
  Avatar, Button, CopyButton, Dialog, QrCode, Select, Tag, TextArea, TextField,
} from '@peers-touch/ui';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

interface ProfileLink { id: string; label: string; url: string }

const INITIAL_LINKS: ProfileLink[] = [
  { id: 'link-1', label: '共享书架', url: 'https://songshelf.local/linye' },
];

const TIMEZONES = ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles'];

function readImage(file: File | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('no file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function ImagePick({ label, onPick }: { label: string; onPick: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={event => { const file = event.target.files?.[0]; if (file) void readImage(file).then(onPick); event.target.value = ''; }} />
      <Button actionId="account.pick-image" emphasis="quiet" density="compact" leading={<Camera size={13} />}
        label={label} onActivate={() => inputRef.current?.click()} />
    </>
  );
}

type LinkStage = 'qr' | 'approve' | 'finishing' | 'complete' | 'expired';

export function AccountSection() {
  const [displayName, setDisplayName] = useState('林野');
  const [bio, setBio] = useState('共享书架轮值 · 小区生活圈 · 喜欢把邻居连接起来的小事');
  const [region, setRegion] = useState('上海');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [tags, setTags] = useState<string[]>(['书架', '种子交换']);
  const [tagDraft, setTagDraft] = useState('');
  const [links, setLinks] = useState<ProfileLink[]>(INITIAL_LINKS);
  const [avatar, setAvatar] = useState<string>('');
  const [banner, setBanner] = useState<string>('');

  const [linkOpen, setLinkOpen] = useState(false);
  const [stage, setStage] = useState<LinkStage>('qr');

  const addTag = () => {
    const value = tagDraft.trim();
    if (value && !tags.includes(value)) setTags(list => [...list, value]);
    setTagDraft('');
  };
  const addLink = () => setLinks(list => [...list, { id: `local-${Date.now()}`, label: '', url: '' }]);

  const openDeviceLink = () => { setStage('qr'); setLinkOpen(true); };
  const startApproval = () => setStage('approve');
  const allow = () => {
    setStage('finishing');
    window.setTimeout(() => setStage('complete'), 800);
  };

  return (
    <>
      <SettingsSection title="身份" subtitle="你在本站与联邦内展示的身份信息">
        <div className="sk-banner" data-has-image={banner ? 'true' : 'false'}>
          {banner && <img src={banner} alt="头图" />}
          <div className="sk-banner-action"><ImagePick label="更换头图" onPick={setBanner} /></div>
        </div>
        <div className="sk-identity-row">
          <div className="sk-identity-avatar">
            <Avatar name={displayName} source={avatar || undefined} background="#22302a"
              size={80} style={{ borderRadius: 22 }} />
            <ImagePick label="更换头像" onPick={setAvatar} />
          </div>
          <div className="sk-identity-meta">
            <div className="sk-identity-names">
              <strong>{displayName || '未命名'}</strong>
              <Tag tone="info">@{displayName ? 'linye' : ''}</Tag>
              <Tag>本机身份</Tag>
            </div>
            <div className="sk-identity-stats">
              <span><strong>12</strong> 动态</span>
              <span><strong>86</strong> 关注</span>
              <span><strong>104</strong> 粉丝</span>
              <span className="sk-identity-joined">2025 年 10 月加入</span>
            </div>
          </div>
        </div>
        <SettingsItemCard>
          <div className="sk-identity-fields">
            <div className="sk-identity-field">
              <span>首选用户名</span>
              <code>@linye</code>
              <CopyButton actionId="account.copy-username" text="linye" label="复制" copiedLabel="已复制" />
            </div>
            <div className="sk-identity-field">
              <span>PTID</span>
              <code>ptid:3f9a7c21:8c2e04ab</code>
              <CopyButton actionId="account.copy-ptid" text="ptid:3f9a7c21:8c2e04ab" label="复制" copiedLabel="已复制" />
            </div>
          </div>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection title="设备" subtitle="用二维码把身份关联到新设备">
        <Button actionId="device.link-start" emphasis="secondary" leading={<Smartphone size={15} />}
          label="关联新设备" onActivate={openDeviceLink} />
        <Dialog open={linkOpen} onDismiss={() => setLinkOpen(false)} title="关联新设备" width={400}
          closeLabel="关闭"
          footer={stage === 'complete'
            ? <Button actionId="device.link-done" emphasis="primary" label="完成" onActivate={() => setLinkOpen(false)} />
            : stage === 'expired'
              ? <Button actionId="device.link-refresh" emphasis="primary" label="刷新二维码" onActivate={() => setStage('qr')} />
              : undefined}>
          <div className="sk-device-stage" data-stage={stage}>
            {stage === 'qr' && (
              <>
                <QrCode value="peers-touch://device-link/offer/local-909" label="设备关联二维码" size={220} />
                <p className="sk-device-hint">用新设备的 Peers Touch 扫码</p>
                <Button actionId="device.link-simulate" emphasis="quiet" label="模拟设备扫码请求"
                  onActivate={startApproval} />
              </>
            )}
            {stage === 'approve' && (
              <>
                <strong>iPhone 15 请求关联</strong>
                <span className="sk-device-code">47 2096</span>
                <p className="sk-device-hint">请在两台设备上核对这组数字一致</p>
                <div className="sk-device-decide">
                  <Button actionId="device.link-allow" emphasis="primary" label="允许" onActivate={allow} />
                  <Button actionId="device.link-deny" emphasis="secondary" label="拒绝"
                    onActivate={() => setStage('expired')} />
                </div>
              </>
            )}
            {stage === 'finishing' && <span className="sk-device-status" role="status">正在完成关联…</span>}
            {stage === 'complete' && <span className="sk-device-status" role="status">设备已关联</span>}
            {stage === 'expired' && <span className="sk-device-status" role="status">请求已过期</span>}
          </div>
        </Dialog>
      </SettingsSection>

      <SettingsSection title="公开资料" subtitle="编辑为本地状态，离开视图不持久化">
        <SettingsRow label="显示名称" vertical>
          <TextField aria-label="显示名称" value={displayName} maxLength={60} onValueChange={setDisplayName} />
        </SettingsRow>
        <SettingsRow label="简介" vertical>
          <TextArea framing="embedded" aria-label="简介" value={bio} maxLength={280} characterCount
            minimumRows={3} onValueChange={setBio} data-bio-value={bio} />
        </SettingsRow>
        <div className="sk-form-grid">
          <SettingsRow label="地区" description="可选">
            <TextField aria-label="地区" value={region} onValueChange={setRegion} />
          </SettingsRow>
          <SettingsRow label="时区" description="可选">
            <Select<string> aria-label="时区" searchable options={TIMEZONES.map(value => ({ value, label: value }))}
              value={timezone} onValueChange={value => setTimezone(String(value))} />
          </SettingsRow>
        </div>
        <SettingsRow label="标签" description="回车添加，用于资料检索" vertical>
          <div className="sk-tag-editor">
            {tags.map(tag => (
              <Tag key={tag} tone="neutral" dismissLabel={`移除 ${tag}`}
                onDismiss={() => setTags(list => list.filter(entry => entry !== tag))}>{tag}</Tag>
            ))}
            <TextField className="sk-tag-input" aria-label="添加标签" placeholder="输入标签后回车"
              value={tagDraft} onValueChange={setTagDraft}
              onEnter={event => { event.preventDefault(); addTag(); }} />
          </div>
        </SettingsRow>
        <SettingsRow label="资料链接" vertical>
          <div className="sk-links-head">
            <span><Link2 size={13} /> 展示在资料卡上的链接</span>
            <Button actionId="account.link-add" emphasis="quiet" density="compact" leading={<Plus size={13} />}
              label="添加链接" onActivate={addLink} />
          </div>
          <div className="sk-links-list">
            {links.map((link, index) => (
              <div className="sk-link-row" key={link.id}>
                <TextField aria-label={`链接名称 ${index + 1}`} placeholder="名称" value={link.label}
                  onValueChange={value => setLinks(list => list.map((entry, i) => i === index ? { ...entry, label: value } : entry))} />
                <TextField aria-label={`链接地址 ${index + 1}`} placeholder="https://…" value={link.url}
                  onValueChange={value => setLinks(list => list.map((entry, i) => i === index ? { ...entry, url: value } : entry))} />
                <Button actionId={`account.link-remove-${index}`} emphasis="quiet" density="compact"
                  aria-label="删除链接" leading={<Trash2 size={14} />} label=""
                  onActivate={() => setLinks(list => list.filter((_, i) => i !== index))} />
              </div>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
