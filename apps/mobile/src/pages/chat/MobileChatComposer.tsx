import { useState, type ReactNode, type Ref, type RefObject } from 'react';
import {
  Button, Icon, IconButton, Text, TextArea,
  geometry, type TextAreaProps,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import { EmojiPalettePanel } from '../../components/emoji/EmojiPalettePanel';

export interface MobileChatComposerProps {
  readonly draft: string;
  readonly placeholder: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly composerRef: Ref<HTMLDivElement>;
  readonly inputPanelRef: Ref<HTMLDivElement>;
  readonly inputProps?: TextAreaProps & { [key: `data-${string}`]: string | boolean | undefined };
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => void;
  readonly sendDisabledReason?: string;
  readonly sending: boolean;
  readonly toolsDisabled: boolean;
  readonly inputDisabled: boolean;
  readonly editing: boolean;
  readonly keyboardOpen: boolean;
  readonly title: string;
  readonly context?: { readonly text: string; readonly onCancel: () => void };
  readonly attachments?: ReactNode;
  readonly recording?: { readonly seconds: number; readonly cancel: () => void; readonly finish: () => void };
  readonly onChooseFile: () => void;
  readonly onTakePhoto: () => void;
  readonly onRecordVoice: () => void;
  readonly emojiOpen: boolean;
  readonly onEmojiOpenChange: (open: boolean) => void;
  readonly recentEmojis: readonly string[];
  readonly onEmojiUsed: (emoji: string) => void;
  readonly nativePickers?: ReactNode;
}

/** Render-only writing dock. Draft, media, submission and persistence stay with ChatPage. */
export function MobileChatComposer(props: MobileChatComposerProps) {
  const { t } = useMobileI18n();
  // The "+" capability grid is composer-local state; the emoji panel is owned
  // by ChatPage so focusing the text field can dismiss it. The two are mutually
  // exclusive and both sit above the writing bar.
  const [toolsOpen, setToolsOpen] = useState(false);
  const unavailable = props.toolsDisabled
    ? { kind: 'disabled' as const, reason: t('mobile.chat.composerToolsBusy') }
    : undefined;
  const canSend = !props.sendDisabledReason;

  const insertEmoji = (emoji: string) => {
    const input = props.inputRef.current;
    const start = input?.selectionStart ?? props.draft.length;
    const end = input?.selectionEnd ?? start;
    props.onDraftChange(`${props.draft.slice(0, start)}${emoji}${props.draft.slice(end)}`);
    props.onEmojiUsed(emoji);
    props.onEmojiOpenChange(false);
    requestAnimationFrame(() => {
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const toggleEmoji = () => {
    props.inputRef.current?.blur();
    setToolsOpen(false);
    props.onEmojiOpenChange(!props.emojiOpen);
  };

  const toggleTools = () => {
    props.inputRef.current?.blur();
    props.onEmojiOpenChange(false);
    setToolsOpen((value) => !value);
  };

  const capabilityActions = [
    { id: 'chat.attach.album', iconId: 'image', label: t('mobile.chat.composerAlbum'), onActivate: props.onChooseFile },
    { id: 'chat.attach.camera', iconId: 'camera', label: t('mobile.chat.takePhoto'), onActivate: props.onTakePhoto },
    { id: 'chat.attach.voice', iconId: 'mic', label: t('mobile.chat.composerVoice'), onActivate: props.onRecordVoice },
  ] as const;

  return (
    <footer className="message-composer">
      <div className="message-composer-input-panels" ref={props.inputPanelRef}>
        {props.emojiOpen && (
          <div className="message-composer-panel emoji-panel">
            <EmojiPalettePanel
              recent={props.recentEmojis}
              onSelect={insertEmoji}
            />
          </div>
        )}
        {toolsOpen && (
          <div className="message-composer-panel composer-tools-panel" data-product-surface="chat.composer-tools">
            {capabilityActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="composer-tool-cell"
                data-action-id={action.id}
                disabled={props.toolsDisabled}
                onClick={() => {
                  setToolsOpen(false);
                  action.onActivate();
                }}
              >
                <span className="composer-tool-icon"><Icon iconId={action.iconId} size={26} /></span>
                <span className="composer-tool-label">{action.label}</span>
              </button>
            ))}
          </div>
        )}
        {props.recording && (
          <div className="message-composer-panel voice-recording-panel" data-product-surface="chat.voice-recording">
            <Text>{t('chat.social.composer.recording', { seconds: props.recording.seconds })}</Text>
            <span className="voice-recording-actions">
              <Button actionId="chat.voice.cancel" emphasis="quiet" density="comfortable"
                onActivate={props.recording.cancel}>{t('chat.social.composer.cancelRecord')}</Button>
              <Button actionId="chat.voice.finish" density="comfortable" leading={<Icon iconId="square" size={16} />}
                onActivate={props.recording.finish}>{t('chat.social.composer.finishRecord')}</Button>
            </span>
          </div>
        )}
        {props.attachments}
      </div>
      <div className="message-composer-surface" ref={props.composerRef}>
        <span className="chat-keyboard-context" role="heading" aria-level={1}>{props.title}</span>
        {props.context && (
          <div className="message-editing-banner" data-composer-quote={props.editing ? 'edit' : 'reply'}>
            <Text tone="secondary" truncate>{props.context.text}</Text>
            <IconButton actionId="chat.composer.context.cancel" iconId="close" label={t('common.action.cancel')}
              emphasis="quiet" density="comfortable" onActivate={props.context.onCancel} />
          </div>
        )}
        <div className="message-composer-bar" data-composer-mode={props.editing ? 'editing' : 'compose'}>
          <IconButton actionId="chat.composer.voice" iconId="audio-lines" iconSize={22}
            label={t('mobile.chat.composerVoice')} emphasis="quiet" density="comfortable"
            availability={unavailable} onActivate={props.onRecordVoice} />
          <span className="message-composer-input-frame">
            <TextArea {...props.inputProps} ref={props.inputRef} className="message-composer-input"
              framing="embedded" density="comfortable" autoGrow rows={1}
              minimumRows={geometry.composer.collapsedRows}
              maximumRows={geometry.composer.expandedRows}
              value={props.draft} onValueChange={props.onDraftChange} placeholder={props.placeholder}
              aria-label={props.placeholder} disabled={props.inputDisabled}
              data-product-surface={props.keyboardOpen ? 'chat.composer-keyboard' : undefined}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences" />
          </span>
          <IconButton actionId="chat.composer.emoji" iconId="smile" iconSize={22}
            label={t('mobile.chat.composerEmoji')} emphasis="quiet" density="comfortable"
            aria-pressed={props.emojiOpen} availability={unavailable}
            onActivate={toggleEmoji} />
          {canSend ? (
            <IconButton actionId="chat.send-message" iconId="send" iconSize={18}
              aria-label={t('common.action.send')} label={t('common.action.send')}
              density="comfortable" emphasis="primary"
              execution={props.sending ? 'pending' : 'idle'} onActivate={props.onSend} />
          ) : (
            <IconButton actionId="chat.composer.tools" iconId="plus" iconSize={22}
              label={t('mobile.chat.composerMore')} emphasis="quiet" density="comfortable"
              aria-pressed={toolsOpen} availability={unavailable}
              onActivate={toggleTools} />
          )}
        </div>
        {props.nativePickers}
      </div>
    </footer>
  );
}
