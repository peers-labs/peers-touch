import { useMemo } from 'react';
import {
  BarChart3,
  Link as LinkIcon,
  MapPin,
  Play,
  Repeat2,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { Post } from '../../gen/proto/domain/social/post_pb';
import { MomentImage } from './MomentImage';

export type OpenMomentMedia = (
  postId: string,
  attachmentId: string,
  kind: 'image' | 'video',
  trigger: HTMLButtonElement,
) => void;

interface MomentContentProps {
  readonly post: Post;
  readonly onOpenMedia?: OpenMomentMedia;
}

export function MomentContent({ post, onOpenMedia }: MomentContentProps) {
  const { t } = useMobileI18n();
  const text = useMemo(() => {
    if (post.content.case === 'textPost') return post.content.value.text;
    if (post.content.case === 'imagePost') return post.content.value.text;
    if (post.content.case === 'videoPost') return post.content.value.text;
    if (post.content.case === 'linkPost') return post.content.value.text;
    if (post.content.case === 'pollPost') return '';
    if (post.content.case === 'repostPost') return post.content.value.comment;
    if (post.content.case === 'locationPost') return post.content.value.text;
    return '';
  }, [post.content]);
  const images =
    post.content.case === 'imagePost' ? post.content.value.images : [];

  return (
    <>
      {(text || images.length > 0) && (
        <div className="moments-article-body">
          {text ? <span>{text}</span> : null}
          {images.length === 1 ? (
            <button
              type="button"
              className="moments-image moments-image--single"
              data-acceptance-id="social-media-open"
              data-post-id={post.id}
              onClick={(event) =>
                onOpenMedia?.(
                  post.id,
                  images[0].id,
                  'image',
                  event.currentTarget,
                )
              }
              aria-label={t('mobile.moments.media.open')}
            >
              <MomentImage
                attachment={images[0]}
                alt={images[0].altText || ''}
              />
            </button>
          ) : null}
          {images.length > 1 ? (
            <div
              className={`moments-image-grid moments-image-grid--${
                images.length === 2 ? '2' : '3'
              }`}
            >
              {images.map((image, index) => (
                <button
                  type="button"
                  className="moments-image"
                  key={image.id || index}
                  data-acceptance-id="social-media-open"
                  data-post-id={post.id}
                  onClick={(event) =>
                    onOpenMedia?.(
                      post.id,
                      image.id,
                      'image',
                      event.currentTarget,
                    )
                  }
                  aria-label={t('mobile.moments.media.open')}
                >
                  <MomentImage attachment={image} alt={image.altText || ''} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {post.content.case === 'videoPost' ? (
        <button
          type="button"
          className="moments-content-addon moments-content-video"
          data-acceptance-id="social-media-open"
          data-post-id={post.id}
          onClick={(event) => {
            const video =
              post.content.case === 'videoPost'
                ? post.content.value.video
                : undefined;
            if (video)
              onOpenMedia?.(post.id, video.id, 'video', event.currentTarget);
          }}
          disabled={!post.content.value.video}
        >
          <span>
            <Play size={24} fill="currentColor" />
          </span>
          <small>
            {post.content.value.video
              ? `${post.content.value.video.width || 0}x${
                  post.content.value.video.height || 0
                } · ${post.content.value.video.durationSeconds || 0}s`
              : t('mobile.moments.content.video')}
          </small>
        </button>
      ) : null}

      {post.content.case === 'linkPost' && post.content.value.link ? (
        <div className="moments-content-addon">
          <span className="moments-content-icon">
            <LinkIcon size={17} />
          </span>
          <span>
            <strong>
              {post.content.value.link.title || post.content.value.link.url}
            </strong>
            <small>{post.content.value.link.url}</small>
          </span>
          <span />
        </div>
      ) : null}

      {post.content.case === 'pollPost' && post.content.value.poll ? (
        <div className="moments-poll">
          <strong>
            <BarChart3 size={16} /> {post.content.value.text}
          </strong>
          {post.content.value.poll.options.map((option, index) => (
            <span key={`${index}:${option.text}`}>{option.text}</span>
          ))}
        </div>
      ) : null}

      {post.content.case === 'repostPost' ? (
        <div className="moments-repost">
          <strong>
            <Repeat2 size={15} /> {post.content.value.originalPostId}
          </strong>
          <span>{post.content.value.comment}</span>
        </div>
      ) : null}

      {post.content.case === 'locationPost' && post.content.value.location ? (
        <div className="moments-content-addon">
          <span className="moments-content-icon">
            <MapPin size={17} />
          </span>
          <span>
            <strong>{post.content.value.location.name}</strong>
            <small>{post.content.value.location.address}</small>
          </span>
          <span />
        </div>
      ) : null}
    </>
  );
}
