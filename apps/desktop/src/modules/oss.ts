/**
 * OSS module — owner-side file lifecycle UI for the user's own
 * uploaded attachments. Backed by the v3 `/sub-oss/my-files`,
 * `PATCH /sub-oss/file`, `DELETE /sub-oss/file`, and
 * `POST /sub-oss/file/restore` endpoints.
 *
 * The settings panel is intentionally not registered here yet:
 * the OSS subserver's per-actor knobs (default visibility, TTL
 * preference, cache budget hint) belong on the existing Storage
 * settings tab once that lands. For now this module ships the
 * page only.
 */

import { FolderOpen } from 'lucide-react';
import { registerModule } from './registry';
import { OSSPage } from '../pages/OSSPage';

registerModule({
  id: 'oss',
  name: 'My Files',
  icon: FolderOpen,
  page: OSSPage,
  sidebarEntry: { position: 'top', order: 32, title: 'My Files' },
});
