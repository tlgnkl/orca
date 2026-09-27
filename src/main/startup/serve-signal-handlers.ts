import { SERVE_STOP_READY, SERVE_STOP_REQUEST } from '../../shared/serve-supervisor-control'

type ServeSignalSource = {
  on(event: 'SIGINT' | 'SIGTERM' | 'SIGHUP', listener: () => void): unknown
  on(event: 'message', listener: (message: unknown) => void): unknown
  send?: (message: string, callback: (error: Error | null) => void) => boolean
}

export function registerServeSignalHandlers(
  signalSource: ServeSignalSource,
  quitApplication: () => void
): void {
  // Keep every listener installed so duplicate delivery cannot fall through to default termination.
  signalSource.on('SIGINT', quitApplication)
  signalSource.on('SIGTERM', quitApplication)
  signalSource.on('SIGHUP', quitApplication)
  signalSource.on('message', (message) => {
    if (message === SERVE_STOP_REQUEST) {
      quitApplication()
    }
  })
  // Announce only after quit handling is installed; the supervisor retains earlier stop requests.
  try {
    signalSource.send?.(SERVE_STOP_READY, () => undefined)
  } catch {
    // Console signals remain available when the supervisor has already disconnected.
  }
}
