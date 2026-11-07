/** Build the Linux Electron-compatible sharp tree used by the packaged DSH runtime. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SharpElectronManifest {
  readonly sharpVersion: string
  readonly electronNodeVersion: string
  readonly platformArch: string
}

export interface SharpElectronBuildRecord extends SharpElectronManifest {
  readonly libvipsVersion: string
}

export const SHARP_ELECTRON_DIRECTORY_NAME = 'sharp-electron'
export const SHARP_ELECTRON_MANIFEST_NAME = 'build-manifest.json'

const BUILD_DEV_DEPENDENCIES = ['node-addon-api', 'node-gyp'] as const
const RUNTIME_DEPENDENCIES = ['semver', 'detect-libc', '@img'] as const
const SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

interface StagedSharpManifest {
  readonly name: string
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly optionalDependencies: Record<string, string>
  readonly config: { readonly libvips: string }
}

export function sharpElectronPin(dependencies: Record<string, string>): string {
  const pin = dependencies.sharp
  if (pin === undefined || !/^\d+\.\d+\.\d+$/u.test(pin)) {
    throw new Error(`desktop package: sharp-electron requires an exact sharp pin, found ${JSON.stringify(pin)}`)
  }
  return pin
}

export function pruneSharpStagedManifest(manifest: StagedSharpManifest): StagedSharpManifest {
  const devDependencies: Record<string, string> = {}
  for (const name of BUILD_DEV_DEPENDENCIES) {
    const version = manifest.devDependencies[name]
    if (version === undefined) throw new Error(`desktop package: sharp-electron needs ${name} in sharp devDependencies`)
    devDependencies[name] = version
  }
  return { ...manifest, devDependencies }
}

export function sharpElectronManifestMatches(
  recorded: Partial<SharpElectronManifest> | undefined,
  expected: SharpElectronManifest,
): boolean {
  return recorded !== undefined
    && recorded.sharpVersion === expected.sharpVersion
    && recorded.electronNodeVersion === expected.electronNodeVersion
    && recorded.platformArch === expected.platformArch
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) { const value = (a[i] ?? 0) - (b[i] ?? 0); if (value !== 0) return value }
  return 0
}

function minimumLibvipsVersion(constraint: string): string {
  const match = /^>=(\d+\.\d+\.\d+)$/u.exec(constraint)
  if (match === null) throw new Error(`desktop package: cannot read sharp libvips requirement ${JSON.stringify(constraint)}`)
  return match[1]!
}

function systemLibvipsVersion(): string {
  const probe = spawnSync('pkg-config', ['--modversion', 'vips-cpp'], { encoding: 'utf8' })
  return probe.status === 0 ? probe.stdout.trim() : ''
}

function electronNodeVersion(electron: string): string {
  const probe = spawnSync(electron, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  if (probe.status !== 0) throw new Error('desktop package: cannot read Electron Node version')
  return probe.stdout.trim()
}

function run(command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw new Error(`desktop package: cannot run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`desktop package: sharp-electron ${command} ${args.join(' ')} failed with exit ${String(result.status ?? result.signal)}`)
}

function smokeSharpElectron(output: string, electron: string): void {
  const script = `const sharp = require(${JSON.stringify(join(output, 'dist', 'index.cjs'))}); const png = Buffer.from(${JSON.stringify(SMOKE_PNG_BASE64)}, 'base64'); (async()=>{const m=await sharp(png).metadata(); await sharp(png).raw().toBuffer(); await sharp(png).jpeg({quality:85}).toBuffer(); console.log('sharp-electron smoke ok',m.format,m.width+'x'+m.height)})().catch(e=>{console.error(e);process.exit(1)})`
  const result = spawnSync(electron, ['-e', script], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  if (result.status === 0) return
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  throw new Error(`desktop package: prepared sharp failed under Electron (exit ${String(result.status ?? result.signal)})${detail === '' ? '' : `: ${detail}`}`)
}

function assemblePreparedTree(stage: string, output: string, record: SharpElectronBuildRecord): void {
  mkdirSync(output, { recursive: true })
  for (const entry of ['dist', 'LICENSE', 'package.json']) cpSync(join(stage, entry), join(output, entry), { recursive: true })
  const binding = join(stage, 'src', 'build', 'Release', `sharp-${record.platformArch}-${record.sharpVersion}.node`)
  if (!existsSync(binding)) throw new Error('desktop package: sharp-electron produced no native binding')
  cpSync(binding, join(output, 'src', 'build', 'Release', basename(binding)))
  for (const name of RUNTIME_DEPENDENCIES) {
    if (!existsSync(join(stage, 'node_modules', name))) throw new Error(`desktop package: sharp-electron missing ${name}`)
    cpSync(join(stage, 'node_modules', name), join(output, 'node_modules', name), { recursive: true })
  }
  writeFileSync(join(output, SHARP_ELECTRON_MANIFEST_NAME), `${JSON.stringify(record, null, 2)}\n`)
}

export async function prepareSharpElectron(options: {
  readonly output: string
  readonly scratch: string
  readonly electron: string
}): Promise<void> {
  if (process.platform !== 'linux') throw new Error('desktop package: sharp-electron is Linux-only')
  const require = createRequire(import.meta.url)
  const attachmentManifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'packages/attachment/attachment-local/package.json'), 'utf8')) as { dependencies: Record<string, string> }
  const sharpVersion = sharpElectronPin(attachmentManifest.dependencies)
  const sourceEntry = require.resolve('sharp')
  const source = dirname(dirname(sourceEntry))
  const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as StagedSharpManifest
  const expected: SharpElectronManifest = { sharpVersion, electronNodeVersion: electronNodeVersion(options.electron), platformArch: `${process.platform}-${process.arch}` }
  const manifestPath = join(options.output, SHARP_ELECTRON_MANIFEST_NAME)
  const recorded = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<SharpElectronBuildRecord> : undefined
  const bindingPath = join(options.output, 'src/build/Release', `sharp-${expected.platformArch}-${expected.sharpVersion}.node`)
  if (sharpElectronManifestMatches(recorded, expected) && existsSync(bindingPath)) {
    smokeSharpElectron(options.output, options.electron)
    return
  }
  const libvipsVersion = systemLibvipsVersion()
  const minimum = minimumLibvipsVersion(sourceManifest.config.libvips)
  if (libvipsVersion === '' || compareVersions(libvipsVersion, minimum) < 0) {
    const found = libvipsVersion === '' ? 'not found' : libvipsVersion
    throw new Error(`desktop package: system libvips ${found}; install libvips headers ${minimum} or newer`)
  }
  rmSync(options.scratch, { recursive: true, force: true })
  const stage = join(options.scratch, 'stage')
  cpSync(source, stage, { recursive: true, filter: path => !relative(source, path).startsWith('node_modules') })
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(pruneSharpStagedManifest(sourceManifest), null, 2)}\n`)
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-package-lock', '--loglevel=error'], stage)
  run(process.execPath, ['install/build.js'], stage, { ...process.env, SHARP_FORCE_GLOBAL_LIBVIPS: '1', PATH: `${join(stage, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}` })
  const stagedOutput = join(options.scratch, 'output')
  assemblePreparedTree(stage, stagedOutput, { ...expected, libvipsVersion })
  rmSync(options.output, { recursive: true, force: true }); renameSync(stagedOutput, options.output)
  smokeSharpElectron(options.output, options.electron)
}

if (import.meta.main) {
  const electron: unknown = createRequire(import.meta.url)('electron')
  if (typeof electron !== 'string') throw new Error('desktop package: Electron executable unavailable')
  prepareSharpElectron({ output: join(APP_ROOT, '.desktop-build/targets/linux-x64/sharp-electron'), scratch: join(APP_ROOT, '.desktop-build/tmp/sharp-electron'), electron })
}
