// Pure gate for the one-time "wake byte up" install popup. The store evaluates it
// once the app is ready; closing the popup writes INSTALL_PROMPTED_KEY so it never
// auto-shows again (the Topbar pill covers "install later"). No I/O here.
// See docs/superpowers/specs/2026-07-07-install-popup-design.md.

export const INSTALL_PROMPTED_KEY = 'codepet:install-prompted';

export interface InstallPromptGate {
  /** Company state has hydrated — the app is actually on screen. */
  hydrated: boolean;
  /** The onboarding wizard is showing (never pop over it). */
  onboarding: boolean;
  /** The toolkit is already installed (nothing to offer). */
  installed: boolean;
  /** The popup was already auto-shown once (the localStorage flag). */
  prompted: boolean;
}

/** True when the install popup should auto-open. */
export function shouldPromptInstall(g: InstallPromptGate): boolean {
  return g.hydrated && !g.onboarding && !g.installed && !g.prompted;
}
