/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS?: string;
  readonly VITE_ACCEPTANCE_HARNESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __PT_BOOT_READY__?: () => void;
}
