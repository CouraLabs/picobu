import { describe, expect, test } from 'bun:test'
import { closeDialog, dialogStatus, openDialog } from '../../src/states/dialog.state.ts'
import { closeDropdown, dropdownState, openDropdown } from '../../src/states/dropdown.state.ts'
import { setTheme, themeInfo, toggleThemeVariant } from '../../src/states/theme-state.ts'
import { Button } from '../../src/tui/components/button.tsx'
import { Dialog } from '../../src/tui/components/dialog.tsx'
import { Dropdown } from '../../src/tui/components/dropdown.tsx'
import { Marquee } from '../../src/tui/components/marquee.tsx'
import { messageText, openMessageActions } from '../../src/tui/components/session/message-actions.tsx'
import { MessagePartView } from '../../src/tui/components/session/message-part.tsx'
import { ModelSelect } from '../../src/tui/components/session/model-select.tsx'
import { ReasoningPart } from '../../src/tui/components/session/reasoning-part.tsx'
import { SessionHeader } from '../../src/tui/components/session/session-header.tsx'
import { SessionMessages } from '../../src/tui/components/session/session-messages.tsx'
import { SessionPrompt } from '../../src/tui/components/session/session-prompt.tsx'
import { SessionStatus } from '../../src/tui/components/session/session-status.tsx'
import { AskForm } from '../../src/tui/components/session/tools/ask-form.tsx'
import { PlanReview } from '../../src/tui/components/session/tools/plan-review.tsx'
import { TodoList } from '../../src/tui/components/session/tools/todo-list.tsx'
import { ToolPart } from '../../src/tui/components/session/tools/tool-part.tsx'
import { Spinner } from '../../src/tui/components/spinner.tsx'
import { Splash } from '../../src/tui/components/splash.tsx'
import { getClipboardService, setClipboardService } from '../../src/tui/hooks/clipboard.state.ts'
import { ClipboardProvider } from '../../src/tui/hooks/clipboard-provider.tsx'
import { runTui } from '../../src/tui/init.tsx'
import { App } from '../../src/tui/layout/app.tsx'
import { Tab } from '../../src/tui/layout/tab.tsx'
import { DevPage } from '../../src/tui/pages/dev.page.tsx'
import { SessionPage } from '../../src/tui/pages/session-page.tsx'

describe('tui module surface', () => {
  test('dialog opens and closes', () => {
    expect(() => openDialog(() => null as never)).not.toThrow()
    expect(typeof dialogStatus).toBe('function')
    expect(() => closeDialog()).not.toThrow()
  })
  test('dropdown opens and closes', () => {
    openDropdown({ options: [], onSelect: () => {}, placement: { x: 0, y: 0, width: 1, height: 1 }, maxWidth: 10, maxVisible: 5, selected: 0 })
    expect(dropdownState()).toBeDefined()
    closeDropdown()
    expect(dropdownState()).toBeNull()
  })
  test('theme sets and toggles', () => {
    setTheme('monochrome', 'dark')
    expect(themeInfo().name).toBe('monochrome')
    toggleThemeVariant()
    expect(['dark', 'light']).toContain(themeInfo().variant)
    setTheme('monochrome', 'dark')
  })
  test('clipboard service stores reference', () => {
    setClipboardService(null)
    expect(getClipboardService()).toBeNull()
  })
  test('components expose functions', () => {
    for (const component of [
      Button,
      Dialog,
      Dropdown,
      Marquee,
      Spinner,
      Splash,
      SessionHeader,
      SessionStatus,
      SessionMessages,
      SessionPrompt,
      MessagePartView,
      ModelSelect,
      ReasoningPart,
      ToolPart,
      TodoList,
      AskForm,
      PlanReview,
      Tab,
      App,
      SessionPage,
      DevPage,
      ClipboardProvider,
    ]) {
      expect(typeof component).toBe('function')
    }
    expect(typeof openMessageActions).toBe('function')
    expect(typeof messageText).toBe('function')
    expect(typeof runTui).toBe('function')
  })
})

describe('cli and smoke static surface', () => {
  test('cli defines picobu program', async () => {
    const source = await Bun.file('src/cli.ts').text()
    expect(source).toContain('picobu')
    expect(source).toContain('sessions')
    expect(source).toContain('mcp')
  })
  test('smoke creates a session script', async () => {
    const source = await Bun.file('src/dev/smoke.ts').text()
    expect(source).toContain('createSession')
  })
})
