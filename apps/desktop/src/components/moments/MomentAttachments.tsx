import { useTranslation } from 'react-i18next';
import { Image, ImageGrid, VideoPlayer, type ImageGridCopy, type ResourceView } from '@peers-touch/ui';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';
import { getCachedOssAttachmentUrl } from '../../services/ossAttachmentUrlCache';

function MomentAttachment({ resource }: { resource: ResourceView }) {
  const { t } = useTranslation('moments');
  const direct = /^https?:\/\//.test(resource.resourceId);
  const resolved = useOssAttachmentUrl(direct ? null : resource.resourceId);
  const source = direct ? resource.resourceId : resolved ?? undefined;
  const unavailable = !direct && getCachedOssAttachmentUrl(resource.resourceId) === null;
  return <Image resource={{
    ...resource, source, state: source ? 'available' : unavailable ? 'unavailable' : 'loading',
    failureReason: t('moments.lightbox.unavailable'),
  }} loadingLabel={t('moments.lightbox.loading')} alt={resource.name} />;
}

export function MomentAttachments({ cids, alts }: { cids: string[]; alts?: string[] }) {
  const { t } = useTranslation('moments');
  const copy: ImageGridCopy = {
    title: t('moments.lightbox.title'),
    close: t('moments.lightbox.close'),
    previous: t('moments.lightbox.previous'),
    next: t('moments.lightbox.next'),
    singleImage: t('moments.lightbox.singleImage'),
    openImage: (index, total) => t('moments.lightbox.openImage', { index, total }),
  };
  return <ImageGrid images={cids.map((cid, index) => ({
    resourceId: cid, name: alts?.[index] || t('moments.lightbox.image', { index: index + 1 }),
    state: 'loading' as const,
  }))} copy={copy} renderImage={resource =>
    <MomentAttachment key={resource.resourceId} resource={resource} />} />;
}

export function MomentVideoAttachment({ id, poster }: { id: string; poster?: string }) {
  const { t } = useTranslation('moments');
  const direct = /^https?:\/\//.test(id);
  const source = useOssAttachmentUrl(direct || !id ? null : id);
  const directPoster = Boolean(poster && /^https?:\/\//.test(poster));
  const posterSource = useOssAttachmentUrl(!poster || directPoster ? null : poster);
  const url = direct ? id : source ?? undefined;
  return <VideoPlayer resource={{
    resourceId: id, source: url, name: t('moments.content.video'),
    state: url ? 'available' : !id || getCachedOssAttachmentUrl(id) === null ? 'unavailable' : 'loading',
    failureReason: t('moments.lightbox.unavailable'),
  }} loadingLabel={t('moments.lightbox.loading')}
    poster={directPoster ? poster : posterSource ?? undefined} />;
}
