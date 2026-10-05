export interface ServerConnectionInput {
  baseUrl: string
  // Omit or leave blank to retain the key for the current URL.
  apiKey?: string
}

export interface ServerConnectionSettings {
  baseUrl: string
  hasApiKey: boolean
  usingDefaults: boolean
}
