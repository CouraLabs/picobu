import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { options } from '@config/options.ts'
import { logDebug } from '@shared/logger.ts'

export const LEGACY_LLM_AUTH_FILE = 'auth.json'

export const removeLegacyLlmAuthFile = (systemDir = options.app.systemDir): boolean => {
  const path = join(systemDir, LEGACY_LLM_AUTH_FILE)
  if (!existsSync(path)) return false
  try {
    rmSync(path, { force: true })
    console.warn('picobu: LLM OAuth was removed — deleted the legacy auth.json. Use an API key, a local LiteLLM/Ollama/LM Studio endpoint, or route subscription providers through LiteLLM.')
    return true
  } catch (error) {
    logDebug('swallowed error', { scope: 'legacy-auth-cleanup', error })
    return false
  }
}
