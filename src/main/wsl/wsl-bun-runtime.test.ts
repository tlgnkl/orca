import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import type { WslSpec } from './wsl-runner'
import { ensureWslBunRuntime } from './wsl-bun-runtime'

const fixture = vi.hoisted(() => ({ source: '', hash: '', download: vi.fn() }))
vi.mock('../../shared/orcad-bun-runtime', () => ({
  ORCAD_BUN_RELEASE_ASSETS: {
    'linux-x64-glibc': {
      get executableSha256() {
        return fixture.hash
      }
    }
  }
}))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '/unused-cache' })
}))
vi.mock('../ssh/orcad-bun-runtime-materializer', () => ({
  materializeCachedOrcadBunRuntime: (...args: unknown[]) => fixture.download(...args)
}))
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  vi.clearAllMocks()
})

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "orca wsl '$ "))
  directories.push(home)
  fixture.source = join(home, 'downloaded-bun')
  const content = 'verified runtime fixture'
  fixture.hash = createHash('sha256').update(content).digest('hex')
  await writeFile(fixture.source, content)
  fixture.download.mockResolvedValue(fixture.source)
  const run = async (spec: WslSpec): Promise<string> => {
    if (spec.program === 'uname') {
      return 'x86_64'
    }
    if (spec.program === 'wslpath') {
      return fixture.source
    }
    if (spec.script?.startsWith('getconf')) {
      return 'glibc 2.31'
    }
    if (spec.script === undefined) {
      throw new Error(`Unexpected program ${spec.program}`)
    }
    const result = await runProcess({
      program: '/bin/sh',
      args: ['-c', spec.script],
      env: { HOME: home },
      timeoutMs: 10_000
    })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout.trim()
  }
  return { run, signal: AbortSignal.timeout(30_000), content }
}

describe.skipIf(process.platform === 'win32')('WSL runtime publication scripts', () => {
  it('publishes verified bytes, cleans staging, and reuses them without another download', async () => {
    const setupResult = await setup()
    const executable = await ensureWslBunRuntime(setupResult)
    expect(await readFile(executable, 'utf8')).toBe(setupResult.content)
    expect(await readdir(dirname(executable))).toEqual(['bun'])
    expect(await ensureWslBunRuntime(setupResult)).toBe(executable)
    expect(fixture.download).toHaveBeenCalledOnce()
  })
  it('retains a damaged executable while publishing and reusing a separate verified repair', async () => {
    const setupResult = await setup()
    const original = await ensureWslBunRuntime(setupResult)
    await writeFile(original, 'damaged')
    const repaired = await ensureWslBunRuntime(setupResult)
    expect(repaired).not.toBe(original)
    expect(await readFile(original, 'utf8')).toBe('damaged')
    expect(await readFile(repaired, 'utf8')).toBe(setupResult.content)
    expect(await ensureWslBunRuntime(setupResult)).toBe(repaired)
    expect(fixture.download).toHaveBeenCalledTimes(2)
    expect((await readdir(dirname(original))).some((entry) => entry.startsWith('upload-'))).toBe(
      false
    )
  })
  it('removes a partial copy after failure and retries without exposing it as a runtime', async () => {
    const setupResult = await setup()
    let partialCopy = true
    const execution = {
      ...setupResult,
      run: async (spec: WslSpec): Promise<string> => {
        if (partialCopy && spec.script?.includes("trap 'rm -rf")) {
          partialCopy = false
          // Fail the real publication script after producing partial bytes in its staging file.
          return setupResult.run({
            ...spec,
            script: `cp() { printf partial > "$3"; return 1; }\n${spec.script}`
          })
        }
        return setupResult.run(spec)
      }
    }
    await expect(ensureWslBunRuntime(execution)).rejects.toThrow()
    const home = dirname(fixture.source)
    const runtimeDirectory = join(home, '.cache', 'orca', 'runtimes', fixture.hash)
    expect(await readdir(runtimeDirectory)).toEqual([])
    const executable = await ensureWslBunRuntime(execution)
    expect(await readFile(executable, 'utf8')).toBe(setupResult.content)
    expect(await readdir(runtimeDirectory)).toEqual(['bun'])
  })
})
