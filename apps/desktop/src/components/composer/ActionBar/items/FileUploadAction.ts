import { Paperclip } from 'lucide-react';

import type { ActionBarItem } from '../types';

export const fileUploadAction: ActionBarItem = {
  key: 'fileUpload',
  icon: Paperclip,
  titleKey: 'chat.input.uploadFile',
  onAction: (ctx) => ctx.triggerFileInput(),
};
