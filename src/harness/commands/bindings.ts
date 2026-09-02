/**
 * Per-session exit / accept / insert / session-switch bindings.
 *
 * The CLI renderer and every web socket session each own a `SessionBindings`,
 * so `/quit` tears down the right renderer, the command-accept hook only writes
 * into the textarea of the session that registered it, and picker inserts land
 * in the right session's prompt. Create one per `startPicobu` call and hand it
 * down through the `SessionBindingsProvider` React context.
 */
export type SessionFrontend = "terminal" | "web";

export type SessionBindings = {
  /** The id this session persists under (`~/.picobu/sessions/<folder>/<id>.jsonl`). */
  sessionId: string;
  /** Which surface this session runs on; gates web-exclusive command flags. */
  frontend: SessionFrontend;
  bindExit: (fn: () => void) => void;
  bindCommandAccept: (fn: (name: string) => void) => void;
  acceptCommand: (name: string) => void;
  /**
   * Overwrite this session's prompt textarea with `text` and focus it (used by
   * pickers that stage a command into the prompt, e.g. the contacts picker).
   */
  insertPromptText: (text: string) => void;
  bindInsertPrompt: (fn: (text: string) => void) => void;
  /**
   * Insert a file link (`@path`) at the prompt cursor without disturbing the
   * rest of the text (used by the ctrl+t file picker).
   */
  insertPromptLink: (text: string) => void;
  bindInsertLink: (fn: (text: string) => void) => void;
  fireExit: () => void;
  /**
   * Point this session at another (or a brand-new) session id. Notifies
   * `bindSessionChange` subscribers so the app can swap the live loop.
   */
  switchSession: (sessionId: string) => void;
  /** Subscribe to session-id changes; returns an unsubscribe function. */
  bindSessionChange: (fn: (sessionId: string) => void) => () => void;
};

export const createSessionBindings = ({
  sessionId,
  frontend = "terminal",
}: {
  sessionId: string;
  frontend?: SessionFrontend;
}): SessionBindings => {
  let exitHandler: (() => void) | undefined;
  let acceptHandler: ((name: string) => void) | undefined;
  let insertHandler: ((text: string) => void) | undefined;
  let insertLinkHandler: ((text: string) => void) | undefined;
  const changeHandlers = new Set<(sessionId: string) => void>();

  const api: SessionBindings = {
    sessionId,
    frontend,
    bindExit: (fn) => {
      exitHandler = fn;
    },
    bindCommandAccept: (fn) => {
      acceptHandler = fn;
    },
    acceptCommand: (name) => {
      acceptHandler?.(name);
    },
    insertPromptText: (text) => {
      insertHandler?.(text);
    },
    bindInsertPrompt: (fn) => {
      insertHandler = fn;
    },
    insertPromptLink: (text) => {
      insertLinkHandler?.(text);
    },
    bindInsertLink: (fn) => {
      insertLinkHandler = fn;
    },
    fireExit: () => {
      exitHandler?.();
    },
    switchSession: (next) => {
      api.sessionId = next;
      for (const fn of changeHandlers) fn(api.sessionId);
    },
    bindSessionChange: (fn) => {
      changeHandlers.add(fn);
      return () => {
        changeHandlers.delete(fn);
      };
    },
  };
  return api;
};

