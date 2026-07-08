'use client';
// Tell the server to kill a live build's claude child. Fire-and-forget with
// keepalive so it survives unmounts/tab close; harmless no-op when the session
// is already gone. Shared by the live view's Stop button and "Wrap up".

export function stopBuildSession(buildSessionId: string): void {
  try {
    fetch('/api/build-session/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildSessionId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
