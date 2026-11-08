/** Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/** Fields electron-builder keeps when it rewrites packaged metadata; scripts and devDependencies are expected to disappear. */
const METADATA_KEYS = ['name', 'version', 'main', 'module', 'types', 'exports',
  'dependencies', 'optionalDependencies', 'peerDependencies'] as const

function packageIdentity(body: Buffer): string {
  const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const key of METADATA_KEYS) if (key in parsed) picked[key] = parsed[key]
  return JSON.stringify(picked)
}

/**
 * Compare the complete archived dsh tree with the sealed preparation inventory.
 * @param archivePath - Application ASAR file beside its unpacked directory.
 * @param expected - Verified preparation descriptor, including its complete file inventory.
 * @param preparedRoot - Prepared dsh tree, used to compare packaged metadata by identity instead of raw bytes.
 * @returns Resolves when bytes, file membership and meaningful executable permissions match.
 */
export async function verifyRuntimeArchive(archivePath: string, expected: DesktopRuntimeDescriptor, preparedRoot?: string): Promise<void> {
  const archive = await readAsar(archivePath)
  const descriptor = await archive.readFile(join('dsh', 'desktop-runtime.json'))
  if (!descriptor.equals(Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`))) {
    throw new Error('desktop runtime: archived descriptor differs from preparation')
  }
  const files: { path: string; bytes: number; sha256: string; executable?: boolean; metadata?: string }[] = []
  const unpacked = new Set<string>()
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`desktop runtime: unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archivePath}.unpacked`, name)) : undefined
    if (physical !== undefined && !physical.isFile()) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
    if (node.unpacked === true) unpacked.add(join(`${archivePath}.unpacked`, name))
    if (path === 'desktop-runtime.json') return
    const body = await archive.readFile(name)
    // Only unpacked entries exist as real files after installation, so only there the mode is meaningful.
    // ASAR records executability inconsistently for archived entries: data files that are +x in the prepared
    // tree (libreoffice wasm, helper .js/.cjs) lose it in the archive. Content stays mandatory for every entry.
    const executable = physical === undefined ? undefined : (physical.mode & 0o111) !== 0
    files.push({ path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'),
      ...(executable === undefined ? {} : { executable }),
      ...(preparedRoot !== undefined && path.endsWith('package.json') ? { metadata: packageIdentity(body) } : {}) })
  }
  await visit(archive.getFile('dsh', false), '')
  const entries = await readdir(join(`${archivePath}.unpacked`, 'dsh'), { recursive: true, withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && unpacked.size === 0) return []
      throw error
    })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || !unpacked.has(path)) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const metadataPaths = new Set(files.filter(file => file.metadata !== undefined).map(file => file.path))
  const contentOf = (list: readonly { path: string; bytes: number; sha256: string }[]): { path: string; bytes: number; sha256: string }[] =>
    list.filter(file => !metadataPaths.has(file.path)).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
  const content = contentOf(files)
  const expectedContent = contentOf(expected.files)
  if (JSON.stringify(content) !== JSON.stringify(expectedContent)) throw new Error('desktop runtime: ASAR integrity verification failed')
  for (const file of files) {
    if (file.metadata === undefined) continue
    const prepared = packageIdentity(await readFile(join(preparedRoot!, ...file.path.split('/'))))
    if (prepared !== file.metadata) throw new Error(`desktop runtime: packaged metadata changed for ${file.path}`)
  }
  const modeMismatch = files.find((file) => {
    if (file.executable === undefined) return false
    const want = expected.files.find(candidate => candidate.path === file.path)
    return want !== undefined && want.executable !== file.executable
  })
  if (modeMismatch !== undefined) throw new Error(`desktop runtime: unpacked executable mode mismatch for ${modeMismatch.path}`)
}
