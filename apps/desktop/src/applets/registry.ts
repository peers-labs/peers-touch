import type { ComponentType } from 'react';

interface AppletFrontend {
  settingsPanel?: ComponentType;
  page?: ComponentType;
}

export function hasSettingsPanel(_id: string): boolean {
  return false;
}

export function hasPage(_id: string): boolean {
  return false;
}

export function getAppletFrontend(_id: string): AppletFrontend | null {
  return null;
}
