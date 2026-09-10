import type { JobRow } from '@agent/sessions/session-jobs.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { createSignal, For, onCleanup, onMount } from 'solid-js'

export type JobsDialogProps = {
  manager: SessionManager
  onOpenSession: (sessionId: string, label: string) => void
}

const elapsed = (startedAt: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

const JobRowView = (props: { job: JobRow; live: boolean; onOpen: () => void; onAbort: () => void }) => (
  <box
    flexDirection="row"
    gap={1}
    flexShrink={0}
    alignItems="center">
    <text fg={theme().text}>{props.job.subagent}</text>
    <text fg={theme().textMuted}>{props.job.queued ? 'queued' : props.job.state}</text>
    <text fg={theme().textMuted}>{elapsed(props.job.startedAt)}</text>
    <box
      flexDirection="row"
      gap={1}>
      <Button
        label="Open"
        onClick={props.onOpen}
      />
      <Button
        label={props.live ? 'Abort' : '—'}
        onClick={props.onAbort}
      />
    </box>
  </box>
)

const JobsDialogView = (props: JobsDialogProps) => {
  const [jobs, setJobs] = createSignal<JobRow[]>(props.manager.jobs().slice(-100))

  onMount(() => {
    const off = props.manager.onJobs((rows) => setJobs(rows.slice(-100)))
    onCleanup(off)
  })

  const isLive = (sessionId: string): boolean => props.manager.getSession(sessionId) !== undefined

  return (
    <box
      flexDirection="column"
      width={76}
      paddingX={2}
      paddingY={1}
      gap={1}>
      <box
        border={['bottom']}
        borderColor={theme().border}
        flexShrink={0}>
        <text fg={theme().text}>Subagent jobs</text>
      </box>
      <box
        flexDirection="column"
        gap={1}
        flexShrink={1}>
        <For
          each={jobs()}
          fallback={<text fg={theme().textMuted}>No subagent jobs in this run.</text>}>
          {(job) => (
            <JobRowView
              job={job}
              live={isLive(job.sessionId)}
              onOpen={() => props.onOpenSession(job.sessionId, job.subagent)}
              onAbort={() => {
                if (isLive(job.sessionId)) props.manager.abortJob(job.sessionId)
              }}
            />
          )}
        </For>
      </box>
      <box
        border={['top']}
        borderColor={theme().border}
        flexShrink={0}>
        <text fg={theme().textMuted}>(esc to close)</text>
      </box>
    </box>
  )
}

export const openJobsDialog = (props: JobsDialogProps) => {
  openDialog(() => <JobsDialogView {...props} />)
}

export const closeJobsDialog = () => {
  closeDialog()
}
