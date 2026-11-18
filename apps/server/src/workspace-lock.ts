import { dlopen, read } from "bun:ffi";
import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { getSystemErrorName } from "node:util";

const LOCK_EX = 2;
const LOCK_NB = 4;
const flockSignature = { args: ["int", "int"], returns: "int" } as const;
const errnoSignature = { args: [], returns: "ptr" } as const;

function loadFlock() {
  if (process.platform === "darwin") {
    const { symbols } = dlopen("/usr/lib/libSystem.B.dylib", {
      flock: flockSignature,
      __error: errnoSignature,
    });
    return { flock: symbols.flock, errno: symbols.__error };
  }
  if (process.platform === "linux") {
    const { symbols } = dlopen("libc.so.6", {
      flock: flockSignature,
      __errno_location: errnoSignature,
    });
    return { flock: symbols.flock, errno: symbols.__errno_location };
  }
  throw new Error("Workspace locking requires macOS or glibc Linux. Use Docker on other systems.");
}

let native: ReturnType<typeof loadFlock> | undefined;

/** Hold the directory itself so separate containers sharing its mount need no lock file. */
export function acquireWorkspaceLock(directory: string): () => void {
  native ??= loadFlock();
  const { flock, errno } = native;
  mkdirSync(directory, { recursive: true });
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    if (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      const address = errno();
      const code = address === null ? 0 : read.i32(address);
      if (code === osConstants.errno.EWOULDBLOCK || code === osConstants.errno.EAGAIN) {
        throw new Error(`Workspace directory is already in use: ${directory}`);
      }
      const reason = code ? getSystemErrorName(-code) : "unknown error";
      throw new Error(`Cannot lock workspace directory "${directory}": ${reason}`);
    }
    return () => closeSync(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
