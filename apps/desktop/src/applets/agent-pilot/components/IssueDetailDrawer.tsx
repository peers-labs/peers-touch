/**
 * Agent Pilot — Issue detail drawer (description, comments, relationships, attachments, workspaces)
 */
import { useState, useEffect, useCallback } from 'react';
import { Drawer, Descriptions, Input, Button, List, message } from 'antd';
import { Send, Link2, MessageSquare, Paperclip } from 'lucide-react';
import {
  listIssueComments,
  createIssueComment,
  listIssueRelationships,
  listAttachments,
  getIssueWorkspaces,
} from '../api';
import type { Issue, IssueComment, IssueRelationship, Tag, Workspace } from '../types';

interface Props {
  open: boolean;
  issue: Issue | null;
  tags?: Tag[];
  onClose: () => void;
  onRefresh: () => void;
  onEdit?: (issue: Issue) => void;
}

export function IssueDetailDrawer({ open, issue, tags = [], onClose, onRefresh, onEdit }: Props) {
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [relationships, setRelationships] = useState<IssueRelationship[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const [commentInput, setCommentInput] = useState('');

  const load = useCallback(async () => {
    if (!issue?.id) return;
    try {
      const [c, r, w, a] = await Promise.all([
        listIssueComments(issue.id),
        listIssueRelationships(issue.id),
        getIssueWorkspaces(issue.id),
        listAttachments(issue.id),
      ]);
      setComments(c);
      setRelationships(r);
      setWorkspaces(w);
      setAttachments(a.map((x) => ({ id: x.id, filename: x.filename })));
    } catch {
      // ignore
    }
  }, [issue?.id]);

  useEffect(() => {
    if (open && issue) load();
  }, [open, issue, load]);

  const handleAddComment = async () => {
    if (!issue?.id || !commentInput.trim()) return;
    try {
      await createIssueComment(issue.id, commentInput.trim());
      setCommentInput('');
      load();
      onRefresh();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Drawer
      title={issue ? `${issue.simple_id} ${issue.title}` : ''}
      placement="right"
      size="default"
      open={open}
      onClose={onClose}
      extra={
        onEdit && issue ? (
          <Button type="primary" size="small" onClick={() => onEdit(issue)}>
            Edit
          </Button>
        ) : null
      }
    >
      {!issue ? null : (
        <>
          <Descriptions column={1} size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label="Status">{issue.status_id}</Descriptions.Item>
            <Descriptions.Item label="Priority">{issue.priority ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Assignee">{issue.assignee ? `@${issue.assignee}` : '-'}</Descriptions.Item>
            {tags.length > 0 && (
              <Descriptions.Item label="Tags">
                {tags.map((t) => (
                  <span
                    key={t.id}
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: t.color || '#eee',
                      color: '#fff',
                      marginRight: 4,
                    }}
                  >
                    {t.name}
                  </span>
                ))}
              </Descriptions.Item>
            )}
          </Descriptions>

          {issue.description && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>Description</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{issue.description}</div>
            </div>
          )}

          {workspaces.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
                <Link2 size={12} style={{ marginRight: 4 }} /> Workspaces
              </div>
              <List
                size="small"
                dataSource={workspaces}
                renderItem={(w) => (
                  <List.Item>{w.name ?? w.id}</List.Item>
                )}
              />
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
              <MessageSquare size={12} style={{ marginRight: 4 }} /> Comments
            </div>
            <List
              size="small"
              dataSource={comments}
              renderItem={(c) => (
                <List.Item>
                  <div>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{c.author || 'Anonymous'}</span>
                    <div>{c.message}</div>
                  </div>
                </List.Item>
              )}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Input.TextArea
                placeholder="Add comment..."
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                rows={2}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
              />
              <Button type="primary" icon={<Send size={14} />} onClick={handleAddComment} />
            </div>
          </div>

          {relationships.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>Relationships</div>
              <List
                size="small"
                dataSource={relationships}
                renderItem={(r) => (
                  <List.Item>
                    {r.relationship_type}: {r.related_issue_id}
                  </List.Item>
                )}
              />
            </div>
          )}

          {attachments.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
                <Paperclip size={12} style={{ marginRight: 4 }} /> Attachments
              </div>
              <List
                size="small"
                dataSource={attachments}
                renderItem={(a) => (
                  <List.Item>{a.filename}</List.Item>
                )}
              />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
