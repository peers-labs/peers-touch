import { describe, expect, it } from 'vitest';

import {
  modelMenuIconStyle,
  modelMenuItemStyle,
  modelMenuLabelStyle,
  modelMenuTextStyle,
} from './modelPickerLayout';

describe('model picker layout', () => {
  it('keeps long model names inside the menu item', () => {
    expect(modelMenuItemStyle.minWidth).toBe(0);
    expect(modelMenuLabelStyle).toMatchObject({
      minWidth: 0,
      width: '100%',
      overflow: 'hidden',
    });
    expect(modelMenuIconStyle.flex).toBe('0 0 auto');
    expect(modelMenuTextStyle).toMatchObject({
      minWidth: 0,
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });
});
