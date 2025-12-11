import { createContextKey } from '@connectrpc/connect'

// User type for self-hosted mode
export interface SelfHostedUser {
  sub: string
}

// Create a type-safe context key for the user
export const kUser = createContextKey<SelfHostedUser | undefined>(undefined, {
  description: 'Self-hosted user',
})
