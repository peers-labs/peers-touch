import { Image as ImageIcon } from 'lucide-react';

import type { ActionBarItem } from '../types';

export const fileUploadAction: ActionBarItem = {
  key: 'fileUpload',
  icon: ImageIcon,
  titleKey: 'chat.input.uploadFile',
  onAction: (ctx) => ctx.triggerFileInput(),
};
