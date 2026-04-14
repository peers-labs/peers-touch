/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_PORT?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_STATION_PROXY_TARGET?: string;
  readonly VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PT_BOOT_READY__?: () => void;
}
