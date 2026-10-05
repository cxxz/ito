interface ImportMetaEnv {
  readonly VITE_ITO_API_BASE_URL?: string
  readonly VITE_ITO_API_KEY?: string
  readonly VITE_ITO_APP_ENV?: string
  readonly VITE_ITO_APP_VERSION: string
  readonly VITE_ITO_PLATFORM_OVERRIDE?: string
  readonly VITE_ITO_UPDATER_BUCKET?: string
  readonly VITE_ITO_ENABLE_DEV_UPDATES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.webm' {
  const src: string
  export default src
}
