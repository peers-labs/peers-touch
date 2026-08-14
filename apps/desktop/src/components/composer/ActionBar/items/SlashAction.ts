import { Slash } from 'lucide-react';

import type { ActionBarItem } from '../types';

export const slashAction: ActionBarItem = {
  key: 'slash',
  icon: Slash,
  titleKey: 'chat.input.slashCommand',
  onAction: (ctx) => {
    const el = ctx.textareaRef.current;
    if (el) el.focus();
    ctx.insertText('/');
  },
};
