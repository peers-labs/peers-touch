/**
 * Navigation type definitions shared across the application.
 */

import type { Page } from '../utils/constants';

export interface Navigation {
  page: Page;
  navigateTo: (page: Page) => void;
}
