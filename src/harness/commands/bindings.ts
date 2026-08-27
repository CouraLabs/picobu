/**
 * Live exit / accept bindings. App runtime binds these hooks:
 * - `bindExit` (index.tsx -> opentui.destroy()) drives the `/quit` family.
 * - `bindCommandAccept` (Prompt.tsx) writes the accepted command name into
 *   the textarea.
 *
 * Kept in their own module so the system command files (which fire them via
 * `fireExit`) don't need to import the `index.ts` facade — no import cycle.
 */
let exitHandler: (() => void) | undefined;
let acceptHandler: ((name: string) => void) | undefined;

export const bindExit = (fn: () => void): void => {
  exitHandler = fn;
};

export const bindCommandAccept = (fn: (name: string) => void): void => {
  acceptHandler = fn;
};

export const acceptCommand = (name: string): void => {
  acceptHandler?.(name);
};

export const fireExit = (): void => exitHandler?.();