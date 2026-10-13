import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Globe, ImagePlus, UserCheck, Users, X } from 'lucide-react';
import { demoAvatarUrls, demoMediaBackgrounds } from '../data';
import type { MomentAudience } from '../types';
import { IdentityAvatar } from './IdentityAvatar';

const AUDIENCES: { id: MomentAudience; label: string; Icon: typeof Globe }[] = [
  { id: 'public', label: 'Public', Icon: Globe },
  { id: 'followers', label: 'Followers', Icon: UserCheck },
  { id: 'circles', label: 'Circles', Icon: Users },
];

const MEDIA_CHOICES = [
  demoMediaBackgrounds.rooftopSunset,
  demoMediaBackgrounds.waterfront,
  demoMediaBackgrounds.colorSwatches,
  demoMediaBackgrounds.componentStudy,
  demoMediaBackgrounds.tokenNotebook,
  demoMediaBackgrounds.teamReview,
];
const MAX_IMAGES = 3;

export interface NewMomentPayload {
  text: string;
  images: string[];
  audience: MomentAudience;
}

export function NewMomentSheet({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: NewMomentPayload) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [audience, setAudience] = useState<MomentAudience>('public');
  // Portal to the device shell root so the backdrop covers the tab bar,
  // matching the Find People / call overlays.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPortalTarget(document.querySelector('.mp-app-shell') ?? document.body);
    const previousFocus = document.activeElement;
    textareaRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = sheetRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function addImage() {
    setImages((prev) => (prev.length >= MAX_IMAGES
      ? prev
      : [...prev, MEDIA_CHOICES[prev.length % MEDIA_CHOICES.length]]));
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, current) => current !== index));
  }

  const canSubmit = Boolean(text.trim()) || images.length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({ text: text.trim(), images, audience });
  }

  const sheet = (
    <div className="mp-action-sheet-backdrop" onClick={onClose}>
      <section
        ref={sheetRef}
        className="mp-action-sheet mp-moment-composer-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-moment-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-moment-composer-header">
          <button type="button" className="mp-moment-composer-cancel" onClick={onClose}>Cancel</button>
          <h2 className="mp-moment-composer-title" id="new-moment-title">New post</h2>
          <button
            type="button"
            className="mp-moment-composer-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            Post
          </button>
        </header>

        <div className="mp-moment-composer-author">
          <IdentityAvatar name="Alice Chen" initials="AC" src={demoAvatarUrls.alice} size={40} />
          <div className="mp-moment-composer-meta">
            <span className="mp-moment-composer-name">Alice Chen</span>
            <div className="mp-audience-segment" role="group" aria-label="Post audience">
              {AUDIENCES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`mp-audience-option ${audience === id ? 'active' : ''}`}
                  aria-pressed={audience === id}
                  onClick={() => setAudience(id)}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          className="mp-moment-composer-textarea"
          placeholder="What's on your mind?"
          value={text}
          rows={5}
          onChange={(event) => setText(event.target.value)}
        />

        {(images.length > 0 || images.length < MAX_IMAGES) && (
          <div className="mp-moment-composer-media">
            {images.map((image, index) => (
              <div key={`${image}-${index}`} className="mp-moment-composer-thumb">
                <span className="mp-moment-composer-thumb-img" style={{ background: image }} />
                <button
                  type="button"
                  className="mp-moment-composer-thumb-remove"
                  aria-label={`Remove image ${index + 1}`}
                  onClick={() => removeImage(index)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button type="button" className="mp-moment-composer-add-image" onClick={addImage}
                aria-label="Add an image">
                <ImagePlus size={22} />
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );

  return portalTarget ? createPortal(sheet, portalTarget) : null;
}
