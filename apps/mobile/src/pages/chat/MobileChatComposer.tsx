import { useState, type ReactNode, type Ref, type RefObject } from 'react';
import {
  Button, EmojiPicker, FieldFrame, Icon, IconButton, Menu, Text, TextArea,
  geometry, type TextAreaProps,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';

const EMOJIS = ['😀', '😊', '😂', '😍', '👍', '🙏', '🎉', '🔥', '❤️', '✨', '😭', '🤔'] as const;

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
  readonly initiallyExpanded?: boolean;
}

/** Render-only writing dock. Draft, media, submission and persistence stay with ChatPage. */
export function MobileChatComposer(props: MobileChatComposerProps) {
  const { t } = useMobileI18n();
  const [expanded, setExpanded] = useState(props.initiallyExpanded ?? false);
  const unavailable = props.toolsDisabled
    ? { kind: 'disabled' as const, reason: t('mobile.chat.composerToolsBusy') }
    : undefined;
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
  const emojiItems = (items: readonly string[]) => items.map(emoji => ({
    id: emoji, emoji, name: t('mobile.chat.insertEmoji', { emoji }),
  }));
  return (
    <footer className="message-composer">
      <div className="message-composer-input-panels" ref={props.inputPanelRef}>
        {props.emojiOpen && (
          <div className="message-composer-panel emoji-panel">
            {props.recentEmojis.length > 0 && (
              <EmojiPicker presentation="palette" label={t('mobile.chat.recentEmojis')} items={emojiItems(props.recentEmojis)} onSelect={insertEmoji} />
            )}
            <EmojiPicker presentation="palette" label={t('mobile.chat.allEmojis')} items={emojiItems(EMOJIS)} onSelect={insertEmoji} />
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
        <FieldFrame appearance="composer" className="message-composer-row" data-composer-mode={props.editing ? 'editing' : 'compose'}>
          <span className="message-composer-tools">
            <IconButton actionId="chat.composer.emoji" iconId="smile" iconSize={19}
              label={t('mobile.chat.composerEmoji')} emphasis="quiet" density="comfortable"
              aria-pressed={props.emojiOpen} availability={unavailable}
              onActivate={() => {
                props.inputRef.current?.blur();
                props.onEmojiOpenChange(!props.emojiOpen);
              }} />
            <Menu placement="top" actions={[
              { id: 'chat.attach.file', label: t('mobile.chat.composerFile'), leading: <Icon iconId="folder-open" size={16} />, onActivate: props.onChooseFile },
              { id: 'chat.attach.camera', label: t('mobile.chat.takePhoto'), leading: <Icon iconId="camera" size={16} />, onActivate: props.onTakePhoto },
            ]}>
              <IconButton actionId="chat.composer.attach" iconId="folder-open" iconSize={19}
                label={t('mobile.chat.composerFile')} emphasis="quiet" density="comfortable" availability={unavailable} />
            </Menu>
            <IconButton actionId="chat.composer.voice" iconId="mic" iconSize={19}
              label={t('mobile.chat.composerVoice')} emphasis="quiet" density="comfortable"
              availability={unavailable} onActivate={props.onRecordVoice} />
          </span>
          <span className="message-composer-input-frame">
            <TextArea {...props.inputProps} ref={props.inputRef} className="message-composer-input"
              framing="embedded" density="comfortable" autoGrow rows={1}
              minimumRows={expanded ? geometry.composer.expandedRows : geometry.composer.collapsedRows}
              maximumRows={expanded ? geometry.composer.maximumRows : geometry.composer.expandedRows}
              value={props.draft} onValueChange={props.onDraftChange} placeholder={props.placeholder}
              aria-label={props.placeholder} disabled={props.inputDisabled}
            data-product-surface={expanded ? 'chat.composer-expanded' : props.keyboardOpen ? 'chat.composer-keyboard' : undefined}
              data-composer-expanded={expanded ? 'true' : 'false'}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences" />
          </span>
          <IconButton actionId="chat.composer.expand" iconId={expanded ? 'minimize-2' : 'maximize-2'}
            label={t(expanded ? 'mobile.chat.collapseComposer' : 'mobile.chat.expandComposer')}
            emphasis="quiet" density="comfortable" aria-pressed={expanded}
            onActivate={() => setExpanded(value => !value)} />
          <IconButton actionId="chat.send-message" iconId="send" iconSize={17}
            aria-label={t('common.action.send')} label={t('common.action.send')} density="comfortable" emphasis="primary"
            availability={props.sendDisabledReason ? { kind: 'disabled', reason: props.sendDisabledReason } : undefined}
            execution={props.sending ? 'pending' : 'idle'} onActivate={props.onSend} />
        </FieldFrame>
        {props.nativePickers}
      </div>
    </footer>
  );
}
