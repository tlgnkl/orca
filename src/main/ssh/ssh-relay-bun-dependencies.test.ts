import { beforeEach, expect, it, vi } from 'vitest'
import type { SshConnection } from './ssh-connection'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { decodeRemotePowerShellScript } from './ssh-remote-powershell'
import { installRelayBunDependencies } from './ssh-relay-bun-dependencies'

const mocks = vi.hoisted(() => ({ exec: vi.fn(), write: vi.fn() }))
vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: mocks.exec,
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error &&
    'sshChannelCloseConfirmed' in error &&
    error.sshChannelCloseConfirmed === false
}))
vi.mock('./ssh-relay-install-transfers', () => ({ writeRelayFile: mocks.write }))
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Both transport operations are mocked and never read connection members.
const conn = {} as SshConnection
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

it.each(['linux-x64', 'win32-x64'] as const)(
  'installs only watcher prebuilts through Bun on %s',
  async (platform) => {
    const host = getRemoteHostPlatform(platform)
    await installRelayBunDependencies({ conn, host, directory: '/relay', runtime: '/runtime/bun' })
    const pkg = JSON.parse(mocks.write.mock.calls[0][3])
    expect(pkg.dependencies).toEqual({ '@parcel/watcher': '2.5.6' })
    const raw = mocks.exec.mock.calls[0][1]
    const command = host.os === 'win32' ? decodeRemotePowerShellScript(raw) : raw
    expect(command).toContain('install --ignore-scripts --no-progress')
    expect(command).toContain('/runtime/bun')
    expect(command).not.toContain('npm ')
    expect(command).not.toContain('node-gyp')
  }
)
it('does not suppress unconfirmed installer termination', async () => {
  const error = Object.assign(new Error('still running'), { sshChannelCloseConfirmed: false })
  mocks.exec.mockRejectedValueOnce(error)
  await expect(
    installRelayBunDependencies({
      conn,
      host: getRemoteHostPlatform('linux-x64'),
      directory: '/relay',
      runtime: '/bun'
    })
  ).rejects.toBe(error)
})
it('allows terminal service after a confirmed optional watcher installation failure', async () => {
  mocks.exec.mockRejectedValueOnce(new Error('registry unavailable'))
  await expect(
    installRelayBunDependencies({
      conn,
      host: getRemoteHostPlatform('linux-x64'),
      directory: '/relay',
      runtime: '/bun'
    })
  ).resolves.toBeUndefined()
  expect(console.warn).toHaveBeenCalledOnce()
})

it.each(['linux-x64', 'win32-x64'] as const)(
  'forces replacement of a damaged watcher package on %s',
  async (platform) => {
    const host = getRemoteHostPlatform(platform)
    await installRelayBunDependencies({
      conn,
      host,
      directory: '/relay',
      runtime: '/runtime/bun',
      repair: true
    })
    const raw = mocks.exec.mock.calls[0][1]
    const command = host.os === 'win32' ? decodeRemotePowerShellScript(raw) : raw
    expect(command).toContain('install --ignore-scripts --no-progress --force')
  }
)

it('preserves uncertain termination when cancellation also fires', async () => {
  const controller = new AbortController()
  const uncertain = Object.assign(new Error('installer is still running'), {
    sshChannelCloseConfirmed: false
  })
  mocks.exec.mockImplementationOnce(async () => {
    controller.abort(new Error('caller deadline'))
    throw uncertain
  })
  await expect(
    installRelayBunDependencies({
      conn,
      host: getRemoteHostPlatform('linux-x64'),
      directory: '/relay',
      runtime: '/bun',
      signal: controller.signal
    })
  ).rejects.toBe(uncertain)
})
