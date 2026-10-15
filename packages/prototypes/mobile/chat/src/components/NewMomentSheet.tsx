import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Globe, ImagePlus, UserCheck, Users, X } from 'lucide-react';
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

type NewMomentContent = {
  text: string;
  images: string[];
};

export type NewMomentPayload = NewMomentContent & (
  | { audience: Exclude<MomentAudience, 'circles'>; circleId?: never; circleName?: never }
  | { audience: 'circles'; circleId: string; circleName: string }
);

export interface MomentCircleOption {
  id: string;
  name: string;
  memberCount: number;
}

export function NewMomentSheet({
  defaultAudience,
  circles,
  onClose,
  onSubmit,
}: {
  defaultAudience: Exclude<MomentAudience, 'circles'>;
  circles: MomentCircleOption[];
  onClose: () => void;
  onSubmit: (payload: NewMomentPayload) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [audience, setAudience] = useState<MomentAudience>(defaultAudience);
  const [circleId, setCircleId] = useState('');
  // Portal to the device shell root so the backdrop covers the tab bar,
  // matching the Find People / call overlays.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    setPortalTarget(document.querySelector('.mp-app-shell') ?? document.body);
    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (!portalTarget) return;
    textareaRef.current?.focus();
  }, [portalTarget]);

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

  const hasContent = Boolean(text.trim()) || images.length > 0;
  const hasAudienceTarget = audience !== 'circles' || Boolean(circleId);
  const canSubmit = hasContent && hasAudienceTarget;

  function submit() {
    if (!canSubmit) return;
    const content = { text: text.trim(), images };
    if (audience === 'circles') {
      const circle = circles.find((item) => item.id === circleId);
      if (!circle) return;
      onSubmit({ ...content, audience, circleId: circle.id, circleName: circle.name });
      return;
    }
    onSubmit({ ...content, audience });
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
                  onClick={() => {
                    setAudience(id);
                    if (id !== 'circles') setCircleId('');
                  }}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {audience === 'circles' && (
          <div className="mp-moment-circle-picker" role="group" aria-label="Choose a circle">
            <span className="mp-moment-circle-picker-label">Choose a circle</span>
            {circles.map((circle) => (
              <button
                key={circle.id}
                type="button"
                className={circleId === circle.id ? 'active' : ''}
                aria-pressed={circleId === circle.id}
                data-circle-option={circle.id}
                onClick={() => setCircleId(circle.id)}
              >
                <span>
                  <strong>{circle.name}</strong>
                  <small>{circle.memberCount} members</small>
                </span>
                {circleId === circle.id && <Check size={16} />}
              </button>
            ))}
            {circles.length === 0 && (
              <span className="mp-moment-circle-picker-empty">
                Create a circle before sharing with one.
              </span>
            )}
          </div>
        )}

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
