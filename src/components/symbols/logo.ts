export const logoArray = [
"▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄      ▄     ▄",
"▓     ▓    ▓    ▓       ▓     ▓ ▓▄▄▄▄▄ ▓     ▓",
"▒ ▀▀▀▀▀    ▒    ▒       ▒     ▒ ▒    ▒ ▒     ▒",
"░       ▄▄▄░▄▄▄ ░▄▄▄▄▄▄ ░▄▄▄▄▄░ ░▄▄▄▄░ ░▄▄▄▄▄░"];

export const logo = (): string => {
  return logoArray.join("\n");
}