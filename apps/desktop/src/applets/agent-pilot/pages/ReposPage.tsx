/**
 * Agent Pilot — Repos list + register
 */
import { useState, useEffect, useCallback } from 'react';
import { Button, List, Input, message } from 'antd';
import { Plus } from 'lucide-react';
import { listRepos, registerRepo } from '../api';
import type { Repo } from '../types';

interface Props {
  onBack?: () => void;
}

export function ReposPage({ onBack }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState('');
  const [displayName, setDisplayName] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await listRepos();
      setRepos(list);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRegister = async () => {
    if (!path.trim()) return;
    try {
      await registerRepo({ path: path.trim(), display_name: displayName.trim() || undefined });
      setPath('');
      setDisplayName('');
      message.success('Repo registered');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {onBack && (
        <Button type="text" onClick={onBack} style={{ marginBottom: 16 }}>
          Back
        </Button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Input
          placeholder="Repo path (e.g. /path/to/repo)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ width: 280 }}
        />
        <Input
          placeholder="Display name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{ width: 160 }}
        />
        <Button type="primary" icon={<Plus size={14} />} onClick={handleRegister}>
          Register repo
        </Button>
      </div>
      <List
        loading={loading}
        dataSource={repos}
        renderItem={(r) => (
          <List.Item>
            <List.Item.Meta
              title={r.display_name ?? r.path}
              description={r.path}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
