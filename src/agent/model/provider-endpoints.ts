import { headersForProvider, resolveAuth } from '@agent/model/resolver.ts'
import type { ProviderOptions } from '@config/options.ts'

export const ENDPOINT_FETCH_TIMEOUT_MS = 10_000

export const isFullEndpoint = (endpoint: string): boolean => /^https?:\/\//i.test(endpoint)

export const resolveEndpointUrl = (provider: ProviderOptions, endpoint: string): string => {
  if (isFullEndpoint(endpoint)) return endpoint
  const auth = resolveAuth(provider)
  const base = (auth.baseUrl ?? provider.baseUrl).replace(/\/$/, '')
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${base}${path}`
}

const hasAuthorization = (headers: Record<string, string>): boolean => Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')

export const endpointHeadersFor = (provider: ProviderOptions): Record<string, string> => {
  const headers: Record<string, string> = { ...(headersForProvider(provider) ?? {}) }
  if (!hasAuthorization(headers)) {
    const apiKey = resolveAuth(provider).apiKey
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

export const fetchProviderEndpoint = async (provider: ProviderOptions, endpoint: string, opts?: { signal?: AbortSignal }): Promise<unknown> => {
  const url = resolveEndpointUrl(provider, endpoint)
  const headers = endpointHeadersFor(provider)
  const timeout = AbortSignal.timeout(ENDPOINT_FETCH_TIMEOUT_MS)
  const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`Endpoint ${url} returned ${response.status}`)
  return (await response.json()) as unknown
}
