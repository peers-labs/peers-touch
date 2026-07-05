/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_PORT?: string;
  readonly VITE_API_URL?: string;
  readonly PEERS_STATION_URL?: string;
  readonly VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS?: string;
  readonly VITE_ACCEPTANCE_HARNESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PT_BOOT_READY__?: () => void;
}
