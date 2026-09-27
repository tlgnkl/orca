import { join, resolve } from 'node:path'
import { buildCliRuntime } from './build-cli-runtime.mjs'
import { cliRuntimeFilename } from '../bundled-cli-runtime.cjs'
import { runProcessSync } from './script-child-process.mjs'

const root = resolve(import.meta.dirname, '../..')
await buildCliRuntime(process.platform, process.arch)
const runtime = join(
  root,
  'out/cli-runtime',
  `${process.platform}-${process.arch}`,
  cliRuntimeFilename(process.platform)
)
const env = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', BUN_EXECUTABLE: runtime }
function run(args) {
  const result = runProcessSync({
    program: process.execPath,
    args,
    cwd: root,
    env,
    stdio: 'inherit',
    timeoutMs: 180_000
  })
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`Bundled runtime verification failed: ${result.code}`)
  }
}
run(['config/scripts/build-relay.mjs'])
run([
  'node_modules/typescript/bin/tsc',
  '-p',
  'config/tsconfig.cli.json',
  '--outDir',
  'out',
  '--composite',
  'false',
  '--incremental',
  'false'
])
run(['config/scripts/build-cli-bin.mjs'])
run([
  'node_modules/vitest/vitest.mjs',
  'run',
  '--config',
  'config/vitest.config.ts',
  'src/relay/bun-relay-artifact.integration.test.ts',
  'src/relay/ai-vault-memory-monitor.integration.test.ts',
  'src/main/ai-vault-search/session-search-bun.integration.test.ts',
  'src/main/ssh/ssh-relay-bun-runtime-commands.test.ts',
  'src/main/agent-hooks/wsl-hook-relay-live.integration.test.ts',
  'src/main/native-chat/wsl-transcript-bun.integration.test.ts',
  'src/main/browser/wsl-browser-network-bun.integration.test.ts',
  'src/main/cli/windows-cli-bun.integration.test.ts',
  'src/cli/cli-bun-runtime.integration.test.ts',
  'src/cli/runtime/serve-bun-ipc.integration.test.ts',
  'src/cli/cli-bin.integration.test.ts',
  'src/cli/cli-bin-signals.integration.test.ts',
  'config/scripts/orca-dev-bin.test.mjs'
])
