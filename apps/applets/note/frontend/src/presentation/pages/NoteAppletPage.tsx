import { useEffect } from '@lynx-js/react';
import type { Note } from '../../domain/note';
import { t } from '../../infrastructure/i18n/messages';
import { useNoteController, type NoteController } from '../../application/useNoteController';

const colors = {
  background: '#f4f6fb',
  panel: '#ffffff',
  elevated: '#fbfcff',
  border: '#e4e8f0',
  text: '#1f2329',
  muted: '#646a73',
  subtle: '#8f959e',
  primary: '#2563eb',
  primarySoft: '#eff6ff',
  secondary: '#eef1f6',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  input: '#f9fafb',
  success: '#0f766e',
  successSoft: '#ecfdf5',
};

const px = (value: number) => `${value}px`;

export function NoteAppletPage() {
  const controller = useNoteController();
  const selectedNote = controller.selectedNote;

  return (
    <page style={{ backgroundColor: colors.background }}>
      <view style={{ flex: 1, backgroundColor: colors.background, padding: px(18) }}>
        <view
          style={{
            backgroundColor: colors.panel,
            borderColor: colors.border,
            borderRadius: px(18),
            borderWidth: px(1),
            marginBottom: px(14),
            padding: px(16),
          }}
        >
          <view style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <view style={{ flex: 1, marginRight: px(12) }}>
              <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700', marginBottom: px(4) }}>{t('note.badge.officialApplet')}</text>
              <text style={{ color: colors.text, fontSize: px(26), fontWeight: '700' }}>{t('note.title')}</text>
              <text style={{ color: colors.muted, fontSize: px(13), lineHeight: px(20), marginTop: px(5) }}>{t('note.subtitle')}</text>
            </view>
            <StatusPill loading={controller.loading} mode={controller.mode} />
          </view>
          <view style={{ flexDirection: 'row', marginTop: px(14) }}>
            <ActionButton label={t('note.action.new')} onTap={controller.startCreate} />
            <ActionButton label={t('note.action.refresh')} onTap={controller.load} variant="secondary" />
            <ActionButton label={t('note.action.deleted')} onTap={controller.loadDeleted} variant="secondary" />
          </view>
        </view>

        <view style={{ flexDirection: 'row', marginBottom: px(12) }}>
          <view style={{ flex: 1, marginRight: px(8) }}>
            <input
              key={`search-${controller.searchResetKey}`}
              placeholder={t('note.search.placeholder')}
              confirm-type="search"
              bindinput={(event) => controller.updateSearchQuery(event.detail.value)}
              bindconfirm={() => {
                void controller.search();
              }}
              style={inputStyle}
            />
          </view>
          <ActionButton label={t('note.action.search')} onTap={controller.search} />
          {controller.mode === 'search' ? (
            <ActionButton label={t('note.action.clearSearch')} onTap={controller.clearSearch} variant="secondary" />
          ) : null}
        </view>

        {controller.error ? (
          <view style={{ backgroundColor: colors.dangerSoft, borderColor: '#fecaca', borderRadius: px(12), borderWidth: px(1), padding: px(10), marginBottom: px(12) }}>
            <text style={{ color: colors.danger, fontSize: px(12) }}>{controller.error}</text>
          </view>
        ) : null}

        <view style={{ flex: 1, flexDirection: 'row', minHeight: px(0) }}>
          <view
            style={{
              backgroundColor: colors.panel,
              borderColor: colors.border,
              borderRadius: px(16),
              borderWidth: px(1),
              marginRight: px(12),
              padding: px(12),
              width: px(250),
            }}
          >
            <SectionTitle
              title={controller.mode === 'search' ? t('note.section.searchResults') : controller.mode === 'deleted' ? t('note.section.deleted') : t('note.section.notes')}
              detail={`${controller.notes.length} ${t('note.list.items')}`}
            />
            <view style={{ marginTop: px(8) }}>
              {controller.notes.length === 0 ? (
                <EmptyState />
              ) : (
                controller.notes.map((note) => (
                  <NoteListItem
                    key={note.noteId}
                    note={note}
                    selected={note.noteId === controller.selectedNoteId}
                    onTap={() => controller.selectNote(note.noteId)}
                  />
                ))
              )}
            </view>
          </view>

          <view
            style={{
              backgroundColor: colors.panel,
              borderColor: colors.border,
              borderRadius: px(16),
              borderWidth: px(1),
              flex: 1,
              padding: px(16),
            }}
          >
            <NoteEditorPanel controller={controller} />
            {selectedNote ? (
              <NoteDetail
                note={selectedNote}
                onEdit={controller.startEditSelected}
                onDelete={controller.deleteSelected}
                onRestore={controller.restoreSelected}
              />
            ) : (
              <EmptyState />
            )}
          </view>
        </view>
      </view>
    </page>
  );
}

type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

function ActionButton({ label, onTap, variant = 'primary', disabled = false }: { label: string; onTap: () => void | Promise<void>; variant?: ActionButtonVariant; disabled?: boolean }) {
  const backgroundColor = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.panel : colors.secondary;
  const borderColor = variant === 'danger' ? colors.danger : backgroundColor;
  const textColor = variant === 'primary' ? '#ffffff' : variant === 'danger' ? colors.danger : colors.text;

  return (
    <view
      bindtap={() => {
        if (disabled) return;
        void onTap();
      }}
      style={{
        backgroundColor,
        borderColor,
        borderRadius: px(999),
        borderWidth: px(1),
        marginRight: px(8),
        opacity: disabled ? 0.5 : 1,
        paddingBottom: px(8),
        paddingLeft: px(12),
        paddingRight: px(12),
        paddingTop: px(8),
      }}
    >
      <text style={{ color: textColor, fontSize: px(12), fontWeight: '600' }}>{label}</text>
    </view>
  );
}

function StatusPill({ loading, mode }: { loading: boolean; mode: string }) {
  const label = loading ? t('note.status.loading') : mode === 'deleted' ? t('note.status.deleted') : t('note.status.ready');
  return (
    <view
      style={{
        alignSelf: 'flex-start',
        backgroundColor: loading ? colors.primarySoft : colors.successSoft,
        borderColor: loading ? '#bfdbfe' : '#bbf7d0',
        borderRadius: px(999),
        borderWidth: px(1),
        paddingBottom: px(6),
        paddingLeft: px(10),
        paddingRight: px(10),
        paddingTop: px(6),
      }}
    >
      <text style={{ color: loading ? colors.primary : colors.success, fontSize: px(11), fontWeight: '700' }}>{label}</text>
    </view>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(8) }}>
      <text style={{ color: colors.text, fontSize: px(14), fontWeight: '700' }}>{title}</text>
      <text style={{ color: colors.muted, fontSize: px(11) }}>{detail}</text>
    </view>
  );
}

function NoteListItem({ note, selected, onTap }: { note: Note; selected: boolean; onTap: () => void }) {
  return (
    <view
      bindtap={onTap}
      style={{
        backgroundColor: selected ? colors.primarySoft : colors.elevated,
        borderColor: selected ? '#bfdbfe' : colors.border,
        borderRadius: px(12),
        borderWidth: px(1),
        marginBottom: px(8),
        padding: px(12),
      }}
    >
      <text style={{ color: colors.text, fontSize: px(13), fontWeight: '700' }}>{displayTitle(note)}</text>
      <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(16), marginTop: px(5) }}>{contentPreview(note.content)}</text>
      {note.deletedAt ? (
        <text style={{ color: colors.danger, fontSize: px(10), marginTop: px(4) }}>{t('note.status.deleted')}</text>
      ) : null}
    </view>
  );
}

const inputStyle = {
  backgroundColor: colors.input,
  borderColor: colors.border,
  borderRadius: px(12),
  borderWidth: px(1),
  color: colors.text,
  fontSize: px(12),
  paddingBottom: px(8),
  paddingLeft: px(10),
  paddingRight: px(10),
  paddingTop: px(8),
};

function NoteEditorPanel({ controller }: { controller: NoteController }) {
  const targetNote = controller.editor.mode === 'edit' ? controller.selectedNote : undefined;
  const titlePlaceholder = targetNote?.title || t('note.editor.titlePlaceholder');
  const contentPlaceholder = targetNote?.content || t('note.editor.contentPlaceholder');

  useEffect(() => {
    setLynxInputValue('note-title-input', controller.editor.title);
    setLynxInputValue('note-content-input', controller.editor.content);
  }, [controller.editor.resetKey]);

  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(14), borderWidth: px(1), marginBottom: px(14), padding: px(14) }}>
      <SectionTitle
        title={controller.editor.mode === 'edit' ? t('note.editor.editTitle') : t('note.editor.createTitle')}
        detail={controller.editor.mode === 'edit' ? t('note.editor.editDetail') : t('note.editor.createDetail')}
      />
      {controller.editor.title.trim() || controller.editor.content.trim() ? (
        <EditorDraftPreview title={controller.editor.title} content={controller.editor.content} draftLoaded={controller.editor.draftLoaded} />
      ) : null}
      <view style={{ marginBottom: px(8) }}>
        <text style={{ color: colors.muted, fontSize: px(11), marginBottom: px(4) }}>{t('note.editor.titleLabel')}</text>
        <input
          id="note-title-input"
          key={`title-${controller.editor.resetKey}`}
          placeholder={controller.editor.title || titlePlaceholder}
          maxlength={120}
          bindinput={(event) => controller.updateEditorTitle(event.detail.value)}
          style={inputStyle}
        />
      </view>
      <view style={{ marginBottom: px(10) }}>
        <text style={{ color: colors.muted, fontSize: px(11), marginBottom: px(4) }}>{t('note.editor.contentLabel')}</text>
        <textarea
          id="note-content-input"
          key={`content-${controller.editor.resetKey}`}
          placeholder={controller.editor.content || contentPlaceholder}
          maxlength={4000}
          maxlines={6}
          bindinput={(event) => controller.updateEditorContent(event.detail.value)}
          style={{ ...inputStyle, minHeight: px(92) }}
        />
      </view>
      {targetNote ? (
        <text style={{ color: colors.muted, fontSize: px(11), marginBottom: px(8) }}>{t('note.editor.targetPrefix')}: {displayTitle(targetNote)}</text>
      ) : null}
      {controller.editor.draftLoaded ? (
        <text style={{ color: colors.primary, fontSize: px(11), marginBottom: px(8) }}>{t('note.editor.draftLoaded')}</text>
      ) : null}
      <view style={{ flexDirection: 'row' }}>
        <ActionButton label={controller.editor.mode === 'edit' ? t('note.action.saveChanges') : t('note.action.create')} onTap={controller.saveEditor} disabled={controller.loading} />
        {controller.editor.mode === 'edit' ? (
          <ActionButton label={t('note.action.cancelEdit')} onTap={controller.startCreate} variant="secondary" />
        ) : null}
      </view>
    </view>
  );
}

function EditorDraftPreview({ title, content, draftLoaded }: { title: string; content: string; draftLoaded: boolean }) {
  return (
    <view
      style={{
        backgroundColor: colors.primarySoft,
        borderColor: '#bfdbfe',
        borderRadius: px(12),
        borderWidth: px(1),
        marginBottom: px(10),
        padding: px(10),
      }}
    >
      <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700', marginBottom: px(4) }}>
        {draftLoaded ? t('note.editor.draftLoaded') : t('note.editor.createDetail')}
      </text>
      {title.trim() ? (
        <text style={{ color: colors.text, fontSize: px(13), fontWeight: '700', lineHeight: px(18) }}>{title}</text>
      ) : null}
      {content.trim() ? (
        <text style={{ color: colors.muted, fontSize: px(12), lineHeight: px(18), marginTop: px(4) }}>{contentPreview(content)}</text>
      ) : null}
    </view>
  );
}

function NoteDetail({
  note,
  onEdit,
  onDelete,
  onRestore,
}: {
  note: Note;
  onEdit: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onRestore: () => void | Promise<void>;
}) {
  const blocks = contentBlocks(note.content);
  return (
    <view style={{ flex: 1 }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(12) }}>
        <view style={{ flex: 1, marginRight: px(12) }}>
          <text style={{ color: colors.text, fontSize: px(20), fontWeight: '700', lineHeight: px(26) }}>{displayTitle(note)}</text>
          <text style={{ color: colors.subtle, fontSize: px(11), marginTop: px(4) }}>
            {note.updatedAt ? `${t('note.detail.updatedAt')}: ${note.updatedAt}` : t('note.detail.serviceBacked')}
          </text>
        </view>
        <view style={{ flexDirection: 'row' }}>
          {note.deletedAt ? (
            <ActionButton label={t('note.action.restore')} onTap={onRestore} />
          ) : (
            <view style={{ flexDirection: 'row' }}>
              <ActionButton label={t('note.action.edit')} onTap={onEdit} variant="secondary" />
              <ActionButton label={t('note.action.delete')} onTap={onDelete} variant="danger" />
            </view>
          )}
        </view>
      </view>
      {note.deletedAt ? (
        <text style={{ color: colors.danger, fontSize: px(11), marginBottom: px(12) }}>
          {t('note.detail.deletedAt')}: {note.deletedAt}
        </text>
      ) : null}
      <view style={{ marginTop: px(10) }}>
        {blocks.length === 0 ? (
          <text style={{ color: colors.muted, fontSize: px(13) }}>{t('note.preview.empty')}</text>
        ) : (
          blocks.map((block, index) => (
            block.kind === 'table-row' ? (
              <view
                key={`table-${index}`}
                style={{
                  backgroundColor: colors.primarySoft,
                  borderColor: '#dbeafe',
                  borderRadius: px(12),
                  borderWidth: px(1),
                  marginBottom: px(8),
                  padding: px(10),
                }}
              >
                {block.cells.map((cell, cellIndex) => (
                  <text key={`${index}-${cellIndex}`} style={{ color: colors.text, fontSize: px(13), lineHeight: px(19) }}>{cell}</text>
                ))}
              </view>
            ) : (
              <text key={`paragraph-${index}`} style={{ color: colors.text, fontSize: px(14), lineHeight: px(22), marginBottom: px(10) }}>{block.text}</text>
            )
          ))
        )}
      </view>
    </view>
  );
}

function EmptyState() {
  return (
    <view style={{ alignItems: 'center', justifyContent: 'center', padding: px(24) }}>
      <text style={{ color: colors.muted, fontSize: px(12) }}>{t('note.empty')}</text>
    </view>
  );
}

type ContentBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'table-row'; cells: string[] };

function displayTitle(note: Note): string {
  const title = note.title.trim();
  if (title) return title;
  const preview = contentPreview(note.content);
  return preview === t('note.preview.empty') ? t('note.editor.titlePlaceholder') : preview;
}

function contentPreview(content: string): string {
  const blocks = contentBlocks(content);
  const first = blocks[0];
  if (!first) return t('note.preview.empty');
  const text = first.kind === 'paragraph' ? first.text : first.cells.join(' · ');
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function contentBlocks(content: string): ContentBlock[] {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const blocks: ContentBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: cleanMarkdownText(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isMarkdownTableLine(line)) {
      paragraph.push(line);
      continue;
    }

    flushParagraph();
    const header = parseTableCells(line);
    const nextLine = lines[index + 1];
    const hasSeparator = Boolean(nextLine && isMarkdownTableSeparator(nextLine));
    if (hasSeparator) {
      index += 1;
      while (index + 1 < lines.length && isMarkdownTableLine(lines[index + 1])) {
        index += 1;
        const cells = parseTableCells(lines[index]);
        blocks.push({ kind: 'table-row', cells: pairTableCells(header, cells) });
      }
      continue;
    }

    blocks.push({ kind: 'table-row', cells: header.map(cleanMarkdownText) });
  }

  flushParagraph();
  return blocks;
}

function isMarkdownTableLine(line: string): boolean {
  return line.includes('|') && parseTableCells(line).length > 1;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function parseTableCells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanMarkdownText(cell.trim()))
    .filter(Boolean);
}

function pairTableCells(header: string[], cells: string[]): string[] {
  return cells.map((cell, index) => {
    const label = header[index];
    return label ? `${label}: ${cell}` : cell;
  });
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/[*_`#>]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

type LynxSelectorQuery = {
  select: (selector: string) => {
    'invoke': (options: {
      method: string;
      params?: Record<string, unknown>;
      fail?: () => void;
    }) => LynxSelectorQuery;
  };
  exec: () => void;
};

function setLynxInputValue(id: string, value: string) {
  const queryFactory = (globalThis as {
    lynx?: { createSelectorQuery?: () => LynxSelectorQuery };
  }).lynx?.createSelectorQuery;

  if (!queryFactory) return;
  const query = queryFactory();
  const node = query.select(`#${id}`);
  const invokeUiMethod = node['invoke'].bind(node);
  invokeUiMethod({
    method: 'setValue',
    params: { value },
    fail: () => undefined,
  });
  query.exec();
}
