import { mock } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { mockOptionsModule } from './helpers/mock-options.ts'

if (process.env.PICOBU_REAL_OPTIONS !== '1') {
  mock.module(fileURLToPath(new URL('../src/config/options.ts', import.meta.url)), mockOptionsModule)
  mock.module('@config/options.ts', mockOptionsModule)
}
