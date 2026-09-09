import { themeInfo, indexOfTheme, themes } from "@states/theme-state.ts"

const name = themeInfo().name
const index = indexOfTheme(themes)
console.log(`persisted theme = ${name}, dropdown initial selection = ${themes[index]}`)
if (themes[index] !== name) {
  console.error(`FAIL: dropdown shows "${themes[index]}" but persisted theme is "${name}"`)
  process.exit(1)
}
console.log("PASS: dropdown label matches persisted theme on startup")
