import type { ActionBarItem } from './types';
import { slashAction, fileUploadAction } from './items';

/** Default left-aligned actions for the chat composer */
export const defaultLeftActions: ActionBarItem[] = [
  slashAction,
  fileUploadAction,
];

/** Default right-aligned actions (currently empty; model picker is standalone) */
export const defaultRightActions: ActionBarItem[] = [];
