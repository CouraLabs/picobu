import type { JobRow } from '@agent/sessions/session-jobs.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import type { BackgroundShellEntry } from '@agent/tools/filesystem/background-shell.ts'
import { fmtDuration } from '@shared/format.ts'
import { openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'

export interface JobsDialogProps {
  manager: SessionManager
  onOpenSession: (sessionId: string, label: string) => void
}

const elapsed = (startedAt: number, now: number): string => fmtDuration(Math.max(0, Math.floor((now - startedAt) / 1000)))

const JobRowView = (props: { job: JobRow; now: number; live: boolean; onOpen: () => void; onAbort: () => void }) => (
  <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
    <text fg={theme().text}>{props.job.subagent}</text>
    <text fg={theme().textMuted}>{props.job.queued ? 'queued' : props.job.state}</text>
    <text fg={theme().textMuted}>{elapsed(props.job.startedAt, props.now)}</text>
    <box flexDirection="row" gap={1}>
      <Button label="Open" onClick={props.onOpen} />
      <Button label={props.live ? 'Abort' : '—'} onClick={props.onAbort} />
    </box>
  </box>
)

const truncateCommand = (command: string, max: number): string => (command.length > max ? `${command.slice(0, max - 1)}…` : command)

const ShellJobRowView = (props: { entry: BackgroundShellEntry; now: number; live: boolean; onKill: () => void }) => (
  <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
    <text fg={theme().text}>{truncateCommand(props.entry.command, 40)}</text>
    <text fg={props.live ? theme().warning : theme().textMuted}>{props.entry.status}</text>
    <text fg={theme().textMuted}>{elapsed(props.entry.startedAt, props.now)}</text>
    <Show when={props.entry.exitCode !== undefined}>
      <text fg={theme().textMuted}>{`exit ${props.entry.exitCode}`}</text>
    </Show>
    <Button label={props.live ? 'Kill' : '—'} onClick={props.onKill} />
  </box>
)

const JobsDialogView = (props: JobsDialogProps) => {
  const dims = useTerminalDims()
  const [jobs, setJobs] = createSignal<Array<JobRow>>(props.manager.jobs().slice(-100))
  const [shells, setShells] = createSignal<Array<BackgroundShellEntry>>(props.manager.shellJobs())
  const [now, setNow] = createSignal(Date.now())

  const dialogHeight = (): number => Math.max(10, Math.min(Math.floor(dims().height * 0.9), dims().height - 2))

  onMount(() => {
    const off = props.manager.onJobs((rows) => setJobs(rows.slice(-100)))
    const offShells = props.manager.onShellJobs((entries) => setShells(entries))
    const ticker = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => {
      off()
      offShells()
      clearInterval(ticker)
    })
  })

  const isLive = (sessionId: string): boolean => props.manager.getSession(sessionId) !== undefined
  const hasRunningShells = (): boolean => shells().some((entry) => entry.status === 'running')

  return (
    <box flexDirection="column" width={76} height={dialogHeight()} paddingX={2} paddingY={1} gap={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>Subagent jobs</text>
      </box>
      <scrollbox flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} scrollY overflow="hidden">
        <box flexDirection="column" gap={1}>
          <For each={jobs()} fallback={<text fg={theme().textMuted}>No subagent jobs in this run.</text>}>
            {(job) => (
              <JobRowView
                job={job}
                now={now()}
                live={isLive(job.sessionId)}
                onOpen={() => props.onOpenSession(job.sessionId, job.subagent)}
                onAbort={() => {
                  if (isLive(job.sessionId)) props.manager.abortJob(job.sessionId)
                }}
              />
            )}
          </For>
        </box>
      </scrollbox>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>Background shells</text>
      </box>
      <box flexDirection="column" gap={1} flexShrink={0}>
        <For each={shells()} fallback={<text fg={theme().textMuted}>No background shells in this run.</text>}>
          {(entry) => <ShellJobRowView entry={entry} now={now()} live={entry.status === 'running'} onKill={() => void props.manager.killShellJob(entry.id)} />}
        </For>
      </box>
      <Show when={hasRunningShells()}>
        <box flexDirection="row" flexShrink={0}>
          <Button
            label="Kill all"
            onClick={() =>
              void Promise.all(
                shells()
                  .filter((entry) => entry.status === 'running')
                  .map((entry) => props.manager.killShellJob(entry.id)),
              )
            }
          />
        </box>
      </Show>
      <box border={['top']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().textMuted}>(esc to close)</text>
      </box>
    </box>
  )
}

export const openJobsDialog = (props: JobsDialogProps) => {
  openDialog(() => <JobsDialogView {...props} />)
}
