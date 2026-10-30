/**
 * SecuritySection — prototype counterpart of desktop RecoverySettings.
 * Local-only recovery state: backup status card, recovery-phrase generation
 * with copy, create-backup gating, and a restore confirmation dialog.
 */
import { useState } from 'react';
import { CheckCircle2, KeyRound, ShieldAlert, Upload } from 'lucide-react';
import { Alert, Button, CopyButton, Dialog, TextArea } from '@peers-touch/ui';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

const WORD_POOL = [
  'river', 'maple', 'mint', 'harbor', 'lantern', 'bridge', 'cedar', 'atlas',
  'meadow', 'quartz', 'willow', 'anchor', 'ember', 'garden', 'compass', 'linden',
  'osprey', 'pebble', 'summit', 'creek', 'bicycle', 'shelf', 'paper', 'fennel',
];

function generatePhrase(): string[] {
  return Array.from({ length: 24 }, () => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
}

export function SecuritySection() {
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [backupExists, setBackupExists] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastBackup, setLastBackup] = useState<string>('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');

  const generate = () => {
    setGenerating(true);
    window.setTimeout(() => {
      setPhrase(generatePhrase());
      setGenerating(false);
    }, 500);
  };

  const createBackup = () => {
    if (!phrase) return;
    setCreating(true);
    window.setTimeout(() => {
      setCreating(false);
      setBackupExists(true);
      setRestored(false);
      setLastBackup(new Date().toLocaleString('zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }));
    }, 600);
  };

  const confirmRestore = () => {
    setRestoring(true);
    window.setTimeout(() => {
      setRestoring(false);
      setRestoreOpen(false);
      setRestored(true);
      setPhraseInput('');
    }, 700);
  };

  return (
    <>
      <SettingsSection title="账户恢复" subtitle="恢复密钥是丢失设备后找回身份的唯一方式">
        <SettingsItemCard>
          <div className="sk-recovery-status">
            <span className="sk-recovery-head">
              {backupExists
                ? <CheckCircle2 size={16} className="is-ok" aria-hidden="true" />
                : <ShieldAlert size={16} className="is-warn" aria-hidden="true" />}
              <strong>备份状态</strong>
            </span>
            {backupExists
              ? <span className="sk-recovery-meta">最近备份：{lastBackup}</span>
              : <Alert tone="warning" title="尚未创建备份" description="生成恢复密钥并创建一次本地备份（原型演示）。" />}
            {restored && <Alert tone="success" title="恢复已完成" description="本地状态已模拟恢复。" />}
          </div>
        </SettingsItemCard>

        <SettingsItemCard>
          <SettingsRow label="恢复密钥" description="24 个词，仅显示在本机；请离线保存" vertical>
            {phrase ? (
              <div className="sk-recovery-phrase">
                <ol data-phrase-words={phrase.length}>
                  {phrase.map((word, index) => <li key={`${word}-${index}`}><em>{index + 1}</em>{word}</li>)}
                </ol>
                <CopyButton actionId="security.copy-phrase" text={phrase.join(' ')}
                  label="复制助记词" copiedLabel="已复制" />
              </div>
            ) : (
              <Button actionId="security.generate" emphasis="secondary" leading={<KeyRound size={14} />}
                label="生成恢复密钥" execution={generating ? 'pending' : 'idle'} onActivate={generate} />
            )}
          </SettingsRow>
        </SettingsItemCard>

        <div className="sk-recovery-actions">
          <Button actionId="security.backup-create" emphasis="primary" leading={<Upload size={14} />}
            label="创建备份" execution={creating ? 'pending' : 'idle'}
            availability={!phrase || creating
              ? { kind: 'disabled', reason: phrase ? '正在创建' : '请先生成恢复密钥' }
              : undefined}
            onActivate={createBackup} />
          <Button actionId="security.restore-open" emphasis="secondary" label="从助记词恢复"
            onActivate={() => { setRestored(false); setRestoreOpen(true); }} />
        </div>
      </SettingsSection>

      <Dialog open={restoreOpen} onDismiss={() => setRestoreOpen(false)} title="从助记词恢复"
        width={460} closeLabel="关闭"
        footer={
          <>
            <Button actionId="security.restore-cancel" emphasis="quiet" label="取消"
              onActivate={() => setRestoreOpen(false)} />
            <Button actionId="security.restore-confirm" emphasis="primary" label="确认恢复"
              execution={restoring ? 'pending' : 'idle'}
              availability={phraseInput.trim().split(/\s+/).length < 24
                ? { kind: 'disabled', reason: '需要 24 个词' }
                : undefined}
              onActivate={confirmRestore} />
          </>
        }>
        <TextArea framing="embedded" aria-label="输入 24 个助记词" minimumRows={5}
          className="sk-restore-input" placeholder="按顺序输入 24 个助记词，空格分隔"
          value={phraseInput} onValueChange={setPhraseInput} data-restore-value={phraseInput} />
      </Dialog>
    </>
  );
}
