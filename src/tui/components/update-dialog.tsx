import { useRenderer } from '@opentui/solid'
import { installUpdate, relaunchApp, type UpdateInfo, updateCommand } from '@shared/update.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { Button } from '@tui/components/button.tsx'
import { DialogShell } from '@tui/components/shared/dialog-shell.tsx'

export interface UpdateDialogProps {
  current: string
  latest: string
}

const RELAUNCH_DELAY_MS = 150

export const UpdateDialog = (props: UpdateDialogProps) => {
  const renderer = useRenderer()
  const runUpdate = async (): Promise<void> => {
    closeDialog()
    pushToast(`Updating picobu to ${props.latest}…`, 'info')
    const result = await installUpdate(props.latest)
    if (!result.ok) {
      pushToast(`Update failed: ${result.output || 'unknown error'}`, 'error')
      return
    }
    pushToast(`Updated to ${props.latest}. Restarting…`, 'success')
    relaunchApp()
    await new Promise((resolve) => setTimeout(resolve, RELAUNCH_DELAY_MS))
    try {
      renderer.destroy()
    } catch {
      process.exit(0)
    }
  }
  return (
    <DialogShell title="Update available" width={64}>
      <text fg={theme().text}>
        Picobu {props.current} → {props.latest} is available.
      </text>
      <text fg={theme().textMuted}>Update runs: {updateCommand(props.latest).join(' ')}</text>
      <box flexDirection="row" gap={1} justifyContent="flex-end" flexShrink={0}>
        <Button label="Update now" onClick={() => void runUpdate()} />
        <Button label="Later" onClick={closeDialog} />
      </box>
    </DialogShell>
  )
}

export const openUpdateDialog = (info: UpdateInfo): void => {
  openDialog(() => <UpdateDialog current={info.current} latest={info.latest} />)
}
