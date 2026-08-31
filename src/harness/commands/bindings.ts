/**
 * Per-session exit / accept / session-switch bindings.
 *
 * The CLI renderer and every web socket session each own a `SessionBindings`,
 * so `/quit` tears down the right renderer and the command-accept hook only
 * writes into the textarea of the session that registered it. Create one per
 * `startPicobu` call and hand it down through the `SessionBindingsProvider`
 * React context.
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
