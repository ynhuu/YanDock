import { cp, mkdir, rename, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../dist/', import.meta.url))
const destination = fileURLToPath(
  new URL('../../internal/webassets/dist', import.meta.url),
)
const staging = `${destination}.staging`
// Only copy after a successful Vite build with a real entry point.
await stat(`${source}/index.html`)
await mkdir(
  fileURLToPath(new URL('../../internal/webassets/', import.meta.url)),
  { recursive: true },
)
await rm(staging, { recursive: true, force: true })
await cp(source, staging, { recursive: true })
await rm(destination, { recursive: true, force: true })
await rename(staging, destination)
