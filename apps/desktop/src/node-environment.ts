/** Electron Node-mode startup, with private shell launchers scoped to package installation. */

import { delimiter } from 'node:path'

/** Add a native-library directory without dropping inherited search paths. */
export function prependLibraryPath(directory: string, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const current = environment.LD_LIBRARY_PATH
  return { ...environment, LD_LIBRARY_PATH: current === undefined || current === '' ? directory : `${directory}${delimiter}${current}` }
}

/**
 * Select Electron's Node mode and the shell launcher used by package scripts.
 * @param executable - Electron executable running the application.
 * @param bin - Directory containing the node shell launcher.
 * @param environment - Caller environment preserved for plugin execution.
 * @returns Environment for a Node-mode child process.
 */
export function desktopNodeEnvironment(executable: string, bin: string | undefined, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    ...(bin === undefined ? {} : { DSH_DESKTOP_NODE_EXECUTABLE: executable, PATH: `${bin}${delimiter}${environment.PATH ?? ''}` }),
  }
}
