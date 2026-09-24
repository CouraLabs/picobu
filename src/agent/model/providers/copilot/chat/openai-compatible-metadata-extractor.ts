import type { SharedV4ProviderMetadata } from '@ai-sdk/provider'

export type MetadataExtractor = {
  extractMetadata: ({ parsedBody }: { parsedBody: unknown }) => Promise<SharedV4ProviderMetadata | undefined>

  createStreamExtractor: () => {
    processChunk(parsedChunk: unknown): void

    buildMetadata(): SharedV4ProviderMetadata | undefined
  }
}
