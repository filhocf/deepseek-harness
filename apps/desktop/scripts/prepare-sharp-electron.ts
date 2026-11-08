/** Build the Linux Electron-compatible sharp tree used by the packaged DSH runtime. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
  const libDirectory = join(output, 'lib')
  const libraryPath = libDirectory
  const entry = existsSync(join(output, 'dist', 'index.cjs'))
    ? join(output, 'dist', 'index.cjs')
    : join(output, 'linux-x64', 'sharp', 'dist', 'index.cjs')
  if (!existsSync(entry)) throw new Error(`desktop package: prepared sharp has no runtime entry at ${entry}`)
  const script = `const sharp = require(${JSON.stringify(entry)}); const png = Buffer.from(${JSON.stringify(SMOKE_PNG_BASE64)}, 'base64'); (async()=>{const m=await sharp(png).metadata(); await sharp(png).raw().toBuffer(); await sharp(png).jpeg({quality:85}).toBuffer(); console.log('sharp-electron smoke ok',m.format,m.width+'x'+m.height)})().catch(e=>{console.error(e);process.exit(1)})`
  const result = spawnSync(electron, ['-e', script], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LD_LIBRARY_PATH: libraryPath } })
  if (result.status === 0) return
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  throw new Error(`desktop package: prepared sharp failed under Electron (exit ${String(result.status ?? result.signal)})${detail === '' ? '' : `: ${detail}`}`)
}

function nativeBindings(root: string): string[] {
  const result: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.startsWith('sharp-') && entry.name.endsWith('.node')) result.push(path)
    }
  }
  if (existsSync(root)) visit(root)
  return result
}

function assertPreparedBinding(root: string, expected: SharpElectronManifest): void {
  const bindings = nativeBindings(root)
  const expectedName = `sharp-${expected.platformArch}-${expected.sharpVersion}.node`
  if (bindings.length !== 1 || basename(bindings[0]!) !== expectedName) {
    throw new Error(`desktop package: expected exactly one binding ${expectedName}, found ${bindings.map(b => basename(b)).join(', ') || 'none'}`)
  }
  if (bindings.some(binding => binding.endsWith('0.35.4.node'))) throw new Error('desktop package: stale Sharp 0.35.4 binding found')
}

function assemblePreparedTree(stage: string, output: string, record: SharpElectronBuildRecord): void {
  mkdirSync(output, { recursive: true })
  assertPreparedBinding(stage, record)
  for (const entry of ['dist', 'LICENSE', 'package.json']) cpSync(join(stage, entry), join(output, entry), { recursive: true })
  const binding = join(stage, 'src', 'build', 'Release', `sharp-${record.platformArch}-${record.sharpVersion}.node`)
  if (!existsSync(binding)) throw new Error('desktop package: sharp-electron produced no native binding')
  cpSync(binding, join(output, 'src', 'build', 'Release', basename(binding)))
  for (const name of RUNTIME_DEPENDENCIES) {
    if (!existsSync(join(stage, 'node_modules', name))) throw new Error(`desktop package: sharp-electron missing ${name}`)
    cpSync(join(stage, 'node_modules', name), join(output, 'node_modules', name), { recursive: true })
  }
  // The fork's package/ payload is the authoritative patched tree. Its
  // package metadata intentionally names the upstream release, while the
  // wrapper package itself carries the fork revision. Copy the already-built
  // linux-x64 payload instead of resolving optional @img packages from the
  // consuming install, which can otherwise leave a stale 0.35.4 addon beside
  // a 0.35.5 wrapper.
  const linuxPayload = join(stage, 'linux-x64', 'sharp')
  if (existsSync(linuxPayload)) {
    cpSync(linuxPayload, join(output, 'linux-x64', 'sharp'), { recursive: true })
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
  const externalPackage = process.env.DSH_SHARP_ELECTRON_PACKAGE
  if (externalPackage !== undefined && externalPackage !== '') {
    const externalManifestPath = join(externalPackage, 'package.json')
    if (!existsSync(externalManifestPath)) throw new Error(`desktop package: patched sharp package is missing ${externalManifestPath}`)
    const externalManifest = JSON.parse(readFileSync(externalManifestPath, 'utf8')) as { version?: unknown; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
    const externalSharpVersion = String(externalManifest.dependencies?.['sharp-upstream'] ?? '').match(/(?:^|@)sharp@(\d+\.\d+\.\d+)$/u)?.[1]
      ?? String(externalManifest.dependencies?.['sharp-upstream'] ?? '').match(/(\d+\.\d+\.\d+)$/u)?.[1]
      ?? String(externalManifest.version ?? '').match(/^(\d+\.\d+\.\d+)/u)?.[1]
    if (externalSharpVersion !== sharpVersion && !existsSync(join(externalPackage, 'linux-x64', 'sharp'))) throw new Error(`desktop package: patched sharp upstream ${externalSharpVersion ?? 'unknown'} does not match ${sharpVersion}`)
    rmSync(options.output, { recursive: true, force: true })
    cpSync(externalPackage, options.output, { recursive: true, dereference: true })
    const exportedLibDirectory = join(externalPackage, 'lib')
    if (!existsSync(exportedLibDirectory)) throw new Error(`desktop package: patched sharp package is missing libvips payload ${exportedLibDirectory}`)
    const packagedLibDirectory = join(options.output, 'lib')
    rmSync(packagedLibDirectory, { recursive: true, force: true })
    cpSync(exportedLibDirectory, packagedLibDirectory, { recursive: true, dereference: true })
    const packagedSharp = join(options.output, 'linux-x64', 'sharp')
    if (existsSync(packagedSharp)) {
      for (const entry of ['dist', 'package.json']) cpSync(join(packagedSharp, entry), join(options.output, entry), { recursive: true })
    }
    // The builder output is the platform-specific `sharp` package, not the
    // wrapper package. Its runtime dependencies are installed beside the
    // wrapper's package tree and must travel with the external artifact.
    const runtimeNodeModules = join(options.output, 'node_modules')
    const sourceRoots = [
      process.env.DSH_SHARP_ELECTRON_DEPS,
      process.env.DSH_SHARP_ELECTRON_SOURCE,
      dirname(externalPackage),
      dirname(dirname(externalPackage)),
    ].filter((value): value is string => value !== undefined && value !== '')
    const dependencyRoots = sourceRoots.flatMap(root => [join(root, 'node_modules'), join(root, 'package', 'node_modules')])
    if (existsSync(packagedSharp)) {
      rmSync(join(options.output, 'node_modules', '@img'), { recursive: true, force: true })
      rmSync(join(options.output, 'linux-x64', 'sharp', 'node_modules', '@img'), { recursive: true, force: true })
      const packagedNodeModules = join(packagedSharp, 'node_modules')
      mkdirSync(packagedNodeModules, { recursive: true })
      for (const name of ['@img', 'detect-libc', 'semver']) {
        rmSync(join(packagedNodeModules, name), { recursive: true, force: true })
      }
      for (const name of RUNTIME_DEPENDENCIES) {
        const dependency = dependencyRoots.map(root => join(root, name)).find(existsSync)
        if (dependency === undefined) throw new Error(`desktop package: patched sharp package missing runtime dependency ${name}; set DSH_SHARP_ELECTRON_DEPS or DSH_SHARP_ELECTRON_SOURCE`)
        cpSync(dependency, join(packagedNodeModules, name), { recursive: true, dereference: true })
      }
    }
    if (!existsSync(packagedSharp)) {
      mkdirSync(runtimeNodeModules, { recursive: true })
      for (const name of RUNTIME_DEPENDENCIES) {
        const dependency = dependencyRoots.map(root => join(root, name)).find(existsSync)
        if (dependency === undefined) throw new Error(`desktop package: patched sharp package missing runtime dependency ${name}; set DSH_SHARP_ELECTRON_DEPS or DSH_SHARP_ELECTRON_SOURCE`)
        cpSync(dependency, join(runtimeNodeModules, name), { recursive: true, dereference: true })
      }
    }
    rmSync(join(options.output, 'linux-x64', 'sharp', 'node_modules', '@img'), { recursive: true, force: true })
    if (existsSync(packagedSharp)) {
      const packagedNodeModules = join(packagedSharp, 'node_modules')
      for (const name of RUNTIME_DEPENDENCIES) {
        const dependency = dependencyRoots.map(root => join(root, name)).find(existsSync)
        if (dependency === undefined) throw new Error(`desktop package: patched sharp package missing runtime dependency ${name}; set DSH_SHARP_ELECTRON_DEPS or DSH_SHARP_ELECTRON_SOURCE`)
        cpSync(dependency, join(packagedNodeModules, name), { recursive: true, dereference: true })
      }
    }
    const expected: SharpElectronManifest = { sharpVersion, electronNodeVersion: electronNodeVersion(options.electron), platformArch: `${process.platform}-${process.arch}` }
    assertPreparedBinding(options.output, expected)
    const manifestPath = join(options.output, SHARP_ELECTRON_MANIFEST_NAME)
    writeFileSync(manifestPath, `${JSON.stringify({ ...expected, libvipsVersion: 'patched-package' }, null, 2)}\n`)
    smokeSharpElectron(options.output, options.electron)
    return
  }
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
    throw new Error(`desktop package: system libvips ${found}; this build requires ${minimum}. Use the fork's patched sharp-electron pipeline; the Ubuntu runner package is insufficient.`)
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
