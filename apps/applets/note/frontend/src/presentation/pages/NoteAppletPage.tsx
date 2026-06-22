import type { Note } from '../../domain/note';
import { t } from '../../infrastructure/i18n/messages';
import { useNoteController } from '../../application/useNoteController';

const colors = {
  background: '#f7f8fa',
  panel: '#ffffff',
  border: '#d9dde3',
  text: '#1f2329',
  muted: '#646a73',
  primary: '#2563eb',
  danger: '#dc2626',
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
          <ActionButton label={t('note.action.createSample')} onTap={controller.createSample} />
          <ActionButton label={t('note.action.searchSample')} onTap={controller.searchSample} />
          {controller.mode === 'search' ? (
            <ActionButton label={t('note.action.clearSearch')} onTap={controller.clearSearch} />
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
              title={controller.mode === 'search' ? t('note.section.searchResults') : t('note.section.notes')}
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
            {controller.selectedNote ? (
              <NoteDetail note={controller.selectedNote} onDelete={controller.deleteSelected} />
            ) : (
              <EmptyState />
            )}
          </view>
        </view>
      </view>
    </page>
  );
}

function ActionButton({ label, onTap }: { label: string; onTap: () => void | Promise<void> }) {
  return (
    <view
      bindtap={() => {
        void onTap();
      }}
      style={{
        backgroundColor: colors.primary,
        borderRadius: 6,
        marginRight: 8,
        paddingBottom: 8,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
      }}
    >
      <text style={{ color: '#ffffff', fontSize: 12, fontWeight: '600' }}>{label}</text>
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
    </view>
  );
}

function NoteDetail({ note, onDelete }: { note: Note; onDelete: () => void | Promise<void> }) {
  return (
    <view style={{ flex: 1 }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{note.title}</text>
        <view
          bindtap={() => {
            void onDelete();
          }}
          style={{ borderColor: colors.danger, borderRadius: 6, borderWidth: 1, paddingBottom: 6, paddingLeft: 9, paddingRight: 9, paddingTop: 6 }}
        >
          <text style={{ color: colors.danger, fontSize: 12 }}>{t('note.action.delete')}</text>
        </view>
      </view>
      <text style={{ color: colors.muted, fontSize: 11, marginBottom: 12 }}>
        {t('note.detail.identifier')}: {note.noteId}
      </text>
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
