// Backward-compatible re-export. The implementation moved to
// `components/shared/oss/useOssAttachmentUrl.ts` in P3 (Moments
// images need the same hook). Chat callers can keep this import path
// indefinitely; new code should import from the shared location.

export {
  useOssAttachmentUrl as useAttachmentUrl,
  useOssAttachmentUrl,
} from '../shared/oss/useOssAttachmentUrl';
