/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Cloud OAuth client ID for Google Drive sync; without it the Drive option is hidden. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
