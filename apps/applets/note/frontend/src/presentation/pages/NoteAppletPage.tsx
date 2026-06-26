import type { Note } from '../../domain/note';
import { t } from '../../infrastructure/i18n/messages';
import { useNoteController, type NoteController } from '../../application/useNoteController';

const colors = {
  background: '#f7f8fa',
  panel: '#ffffff',
  border: '#d9dde3',
  text: '#1f2329',
  muted: '#646a73',
  primary: '#2563eb',
  secondary: '#e5e7eb',
  danger: '#dc2626',
  input: '#f9fafb',
};

export function NoteAppletPage() {
  const controller = useNoteController();

  return (
    <page>
      <view style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <view style={{ marginBottom: 14 }}>
          <text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{t('note.title')}</text>
          <text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{t('note.subtitle')}</text>
        </view>

        <view style={{ flexDirection: 'row', marginBottom: 12 }}>
          <ActionButton label={t('note.action.refresh')} onTap={controller.load} />
          <ActionButton label={t('note.action.new')} onTap={controller.startCreate} />
          <ActionButton label={t('note.action.deleted')} onTap={controller.loadDeleted} variant="secondary" />
          <view style={{ flex: 1, marginRight: 8 }}>
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
          <view style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, padding: 10, marginBottom: 12 }}>
            <text style={{ color: colors.danger, fontSize: 12 }}>{controller.error}</text>
          </view>
        ) : null}

        <view style={{ flex: 1, flexDirection: 'row' }}>
          <view style={{ width: 210, marginRight: 12 }}>
            <SectionTitle
              title={controller.mode === 'search' ? t('note.section.searchResults') : controller.mode === 'deleted' ? t('note.section.deleted') : t('note.section.notes')}
              detail={controller.loading ? t('note.status.loading') : t('note.status.ready')}
            />
            <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1 }}>
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

          <view style={{ flex: 1, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: 14 }}>
            <NoteEditorPanel controller={controller} />
            {controller.selectedNote ? (
              <NoteDetail
                note={controller.selectedNote}
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

function ActionButton({ label, onTap, variant = 'primary' }: { label: string; onTap: () => void | Promise<void>; variant?: ActionButtonVariant }) {
  const backgroundColor = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.panel : colors.secondary;
  const borderColor = variant === 'danger' ? colors.danger : backgroundColor;
  const textColor = variant === 'primary' ? '#ffffff' : variant === 'danger' ? colors.danger : colors.text;

  return (
    <view
      bindtap={() => {
        void onTap();
      }}
      style={{
        backgroundColor,
        borderColor,
        borderRadius: 6,
        borderWidth: 1,
        marginRight: 8,
        paddingBottom: 8,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
      }}
    >
      <text style={{ color: textColor, fontSize: 12, fontWeight: '600' }}>{label}</text>
    </view>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
      <text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{title}</text>
      <text style={{ color: colors.muted, fontSize: 11 }}>{detail}</text>
    </view>
  );
}

function NoteListItem({ note, selected, onTap }: { note: Note; selected: boolean; onTap: () => void }) {
  return (
    <view
      bindtap={onTap}
      style={{
        backgroundColor: selected ? '#eff6ff' : colors.panel,
        borderBottomColor: colors.border,
        borderBottomWidth: 1,
        padding: 10,
      }}
    >
      <text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{note.title}</text>
      <text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>{note.content}</text>
      {note.deletedAt ? (
        <text style={{ color: colors.danger, fontSize: 10, marginTop: 4 }}>{t('note.status.deleted')}</text>
      ) : null}
    </view>
  );
}

const inputStyle = {
  backgroundColor: colors.input,
  borderColor: colors.border,
  borderRadius: 6,
  borderWidth: 1,
  color: colors.text,
  fontSize: 12,
  paddingBottom: 8,
  paddingLeft: 10,
  paddingRight: 10,
  paddingTop: 8,
};

function NoteEditorPanel({ controller }: { controller: NoteController }) {
  const targetNote = controller.editor.mode === 'edit' ? controller.selectedNote : undefined;
  const titlePlaceholder = targetNote?.title || t('note.editor.titlePlaceholder');
  const contentPlaceholder = targetNote?.content || t('note.editor.contentPlaceholder');

  return (
    <view style={{ borderBottomColor: colors.border, borderBottomWidth: 1, marginBottom: 14, paddingBottom: 14 }}>
      <SectionTitle
        title={controller.editor.mode === 'edit' ? t('note.editor.editTitle') : t('note.editor.createTitle')}
        detail={controller.editor.mode === 'edit' ? t('note.editor.editDetail') : t('note.editor.createDetail')}
      />
      <view style={{ marginBottom: 8 }}>
        <text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{t('note.editor.titleLabel')}</text>
        <input
          key={`title-${controller.editor.resetKey}`}
          placeholder={titlePlaceholder}
          maxlength={120}
          bindinput={(event) => controller.updateEditorTitle(event.detail.value)}
          style={inputStyle}
        />
      </view>
      <view style={{ marginBottom: 10 }}>
        <text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>{t('note.editor.contentLabel')}</text>
        <textarea
          key={`content-${controller.editor.resetKey}`}
          placeholder={contentPlaceholder}
          maxlength={4000}
          maxlines={6}
          bindinput={(event) => controller.updateEditorContent(event.detail.value)}
          style={{ ...inputStyle, minHeight: 92 }}
        />
      </view>
      {targetNote ? (
        <text style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}>
          {t('note.editor.targetPrefix')}: {targetNote.noteId}
        </text>
      ) : null}
      {controller.editor.draftLoaded ? (
        <text style={{ color: colors.primary, fontSize: 11, marginBottom: 8 }}>{t('note.editor.draftLoaded')}</text>
      ) : null}
      <view style={{ flexDirection: 'row' }}>
        <ActionButton label={controller.editor.mode === 'edit' ? t('note.action.saveChanges') : t('note.action.create')} onTap={controller.saveEditor} />
        {controller.editor.mode === 'edit' ? (
          <ActionButton label={t('note.action.cancelEdit')} onTap={controller.startCreate} variant="secondary" />
        ) : null}
      </view>
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
  return (
    <view style={{ flex: 1 }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{note.title}</text>
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
      <text style={{ color: colors.muted, fontSize: 11, marginBottom: 12 }}>
        {t('note.detail.identifier')}: {note.noteId}
      </text>
      {note.deletedAt ? (
        <text style={{ color: colors.danger, fontSize: 11, marginBottom: 12 }}>
          {t('note.detail.deletedAt')}: {note.deletedAt}
        </text>
      ) : null}
      <text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{note.content}</text>
    </view>
  );
}

function EmptyState() {
  return (
    <view style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <text style={{ color: colors.muted, fontSize: 12 }}>{t('note.empty')}</text>
    </view>
  );
}
