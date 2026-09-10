import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClipboardService } from '@opentui/core'
import type { JSX } from '@opentui/solid/jsx-runtime'
import { closeDialog, dialogStatus, openDialog } from '../../src/states/dialog.state.ts'
import type { DropdownOpenState } from '../../src/states/dropdown.state.ts'
import { closeDropdown, dropdownState, openDropdown } from '../../src/states/dropdown.state.ts'
import { indexOfTheme, setTheme, theme, themeInfo, themes, toggleThemeVariant } from '../../src/states/theme-state.ts'
import type { DropdownOption } from '../../src/tui/components/dropdown.tsx'
import { getClipboardService, setClipboardService } from '../../src/tui/hooks/clipboard.state.ts'

const view = (): JSX.Element => null as never
const other = (): JSX.Element => null as never

const fixture = (selected: number): DropdownOpenState => ({
  options: [{ name: 'a' }, { name: 'b', value: 2 }] as DropdownOption[],
  onSelect: () => {},
  placement: { x: 1, y: 2, width: 10, height: 5 },
  maxWidth: 20,
  maxVisible: 5,
  selected,
})

const persistedTheme = (): { theme?: { key?: string } } => {
  const raw = readFileSync(join(homedir(), '.picobu', 'options.json'), 'utf8')
  return (JSON.parse(raw) as { tui: { theme?: { key?: string } } }).tui
}

const waitPersisted = async (key: string): Promise<{ theme?: { key?: string } }> => {
  const start = Date.now()
  for (;;) {
    const tui = persistedTheme()
    if (tui.theme?.key === key || Date.now() - start > 10000) return tui
    await Bun.sleep(25)
  }
}

closeDialog()
const dialogClosed = dialogStatus().status === 'close' && dialogStatus().content === null
openDialog(view)
const dialogOpened = dialogStatus().status === 'open' && dialogStatus().content === view
openDialog(other)
const dialogReplaced = dialogStatus().content === other
closeDialog()
const dialogCleared = dialogStatus().status === 'close' && dialogStatus().content === null
closeDialog()
openDialog(view)
const toggleA = dialogStatus().status
closeDialog()
const toggleB = dialogStatus().status
openDialog(view)
const toggleC = dialogStatus().status
closeDialog()

closeDropdown()
const dropdownNull = dropdownState() === null
openDropdown(fixture(0))
const opened = dropdownState()
const dropdownOpened = opened !== null && opened.options.map((o) => o.name).join(',') === 'a,b' && opened.placement.x === 1 && opened.selected === 0
openDropdown(fixture(1))
const dropdownReselected = dropdownState()?.selected === 1
closeDropdown()
const dropdownCleared = dropdownState() === null

setClipboardService(null)
const clipNull = getClipboardService() === null
const first = { id: 'one' } as unknown as ClipboardService
const second = { id: 'two' } as unknown as ClipboardService
setClipboardService(first)
const clipStored = getClipboardService() === first
setClipboardService(second)
const clipReplaced = getClipboardService() === second
setClipboardService(null)
const clipCleared = getClipboardService() === null

const themeInitial = themeInfo()
const themeSyntax = theme().syntax !== undefined && typeof theme().selected === 'function'
const themeIndexHit = indexOfTheme(['nope', 'picobu'])
const themeIndexMiss = indexOfTheme(['nope'])
setTheme('dracula', 'light')
const themeAfterSet = themeInfo()
const themePersisted = await waitPersisted('dracula')
toggleThemeVariant()
const themeAfterToggle = themeInfo()
toggleThemeVariant()
const themeAfterToggleBack = themeInfo()
let unknownThemeError = ''
setTheme('missing-theme', 'dark')
unknownThemeError = themeInfo().name

const result = {
  home: homedir(),
  dialog: { closed: dialogClosed, opened: dialogOpened, replaced: dialogReplaced, cleared: dialogCleared, toggles: [toggleA, toggleB, toggleC] },
  dropdown: { null: dropdownNull, opened: dropdownOpened, reselected: dropdownReselected, cleared: dropdownCleared },
  clipboard: { null: clipNull, stored: clipStored, replaced: clipReplaced, cleared: clipCleared },
  theme: {
    initial: themeInitial,
    count: themes.length,
    hasMonochrome: themes.includes('monochrome'),
    hasPicobu: themes.includes('picobu'),
    sorted: [...themes].sort((a, b) => a.localeCompare(b)).join(',') === themes.join(','),
    syntax: themeSyntax,
    indexHit: themeIndexHit,
    indexMiss: themeIndexMiss,
    afterSet: themeAfterSet,
    persisted: themePersisted,
    afterToggle: themeAfterToggle,
    afterToggleBack: themeAfterToggleBack,
    unknownThemeError,
  },
}

console.log(JSON.stringify(result))
