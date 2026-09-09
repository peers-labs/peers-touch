/**
 * Settings module index — re-exports for the settings page subsystem.
 */

export { useSettingsController } from './useSettingsController';
export type { SettingsController, SettingsControllerState, SettingsSaveStatus } from './useSettingsController';
export {
  defaultDevicePreferences,
  loadDevicePreferences,
  persistDevicePreferences,
} from './devicePreferences';
export type { DevicePreferences, ThemeMode, FontSizePreset } from './devicePreferences';
