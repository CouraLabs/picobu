import { options } from '@config/options.ts'
import { logError } from '@shared/logger.ts'
import { checkForUpdate, type FetchLike, type UpdateInfo } from '@shared/update.ts'
import { getVersion } from '@shared/version.ts'
import { dialogStatus } from '@states/dialog.state.ts'
import { openUpdateDialog } from '@tui/components/update-dialog.tsx'

export interface UpdateCheckOptions {
  enabled?: boolean
  fetchImpl?: FetchLike
}

export const maybePromptForUpdate = async (opts: UpdateCheckOptions = {}): Promise<UpdateInfo | undefined> => {
  const enabled = opts.enabled ?? options.tui.checkForUpdates
  if (!enabled) return undefined
  if (dialogStatus().status !== 'close') return undefined
  const info = await checkForUpdate(getVersion(), opts.fetchImpl)
  if (!info) return undefined
  if (dialogStatus().status !== 'close') return undefined
  openUpdateDialog(info)
  return info
}

export const startUpdateCheck = (opts: UpdateCheckOptions = {}): void => {
  void maybePromptForUpdate(opts).catch((error) => logError(error, { scope: 'update-check' }))
}
