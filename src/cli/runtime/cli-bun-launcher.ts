import { constants } from 'node:os'
import { spawnProcess } from '../../shared/child-process/run-process'
import { CLI_LAUNCHER_CHANNEL_ENV } from './cli-launcher-owner'

export function launchBunCli(runtime: string, entry: string, args: string[]): void {
  const env = { ...process.env }
  if (env.ELECTRON_RUN_AS_NODE === '1' && !env.ORCA_APP_EXECUTABLE) {
    env.ORCA_APP_EXECUTABLE = process.execPath
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  delete env.NODE_REPL_EXTERNAL_MODULE
  delete env.BUN_OPTIONS
  const ownsProcessGroup = process.platform !== 'win32'
  if (ownsProcessGroup) {
    env[CLI_LAUNCHER_CHANNEL_ENV] = '1'
  }
  const child = spawnProcess({
    program: runtime,
    args: [entry, ...args],
    env,
    detached: ownsProcessGroup,
    stdio: ownsProcessGroup ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit'
  })
  const forwardedSignals: NodeJS.Signals[] = ownsProcessGroup
    ? ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGTSTP', 'SIGCONT']
    : ['SIGINT', 'SIGTERM']
  const signals = forwardedSignals.map((signal) => {
    const forward = (): void => {
      // Console Ctrl-C already reaches the Windows child; kill(SIGINT) would force termination.
      if (process.platform !== 'win32' || signal !== 'SIGINT') {
        if (child.pid && (signal === 'SIGTSTP' || signal === 'SIGCONT')) {
          try {
            // The detached session has no controlling terminal to deliver job-control signals.
            process.kill(-child.pid, signal === 'SIGTSTP' ? 'SIGSTOP' : signal)
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
              throw error
            }
          }
        } else {
          child.kill(signal)
        }
        if (signal === 'SIGTSTP') {
          process.kill(process.pid, 'SIGSTOP')
        }
      }
    }
    process.on(signal, forward)
    return { signal, forward }
  })
  const cleanup = (): void => {
    for (const { signal, forward } of signals) {
      process.off(signal, forward)
    }
  }
  child.once('error', (error) => {
    cleanup()
    console.error(error.message)
    process.exitCode = 78
  })
  child.once('exit', (code, signal) => {
    cleanup()
    if (signal && process.platform !== 'win32') {
      process.kill(process.pid, signal)
    } else {
      process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1)
    }
  })
}
