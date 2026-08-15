import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)

function normaliseBuildTimestamp(value, source) {
  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`${source} must be a valid date and time.`)
  }

  return timestamp.toISOString()
}

function resolveBuildTimestamp() {
  const explicitTimestamp = process.env.ADIMARI_BUILD_TIMESTAMP?.trim()
  if (explicitTimestamp) {
    return normaliseBuildTimestamp(explicitTimestamp, 'ADIMARI_BUILD_TIMESTAMP')
  }

  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH?.trim()
  if (sourceDateEpoch) {
    if (!/^\d+$/.test(sourceDateEpoch)) {
      throw new Error('SOURCE_DATE_EPOCH must be a Unix timestamp in seconds.')
    }

    return normaliseBuildTimestamp(
      Number(sourceDateEpoch) * 1000,
      'SOURCE_DATE_EPOCH',
    )
  }

  return new Date().toISOString()
}

function resolveBuildRevision() {
  const explicitRevision = process.env.ADIMARI_BUILD_REVISION?.trim()
  if (explicitRevision) {
    return explicitRevision.slice(0, 12)
  }

  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // Source archives may not include Git metadata. A meaningful package version
    // remains useful in that case, but do not show the starter 0.0.0 placeholder.
    return packageMetadata.version && packageMetadata.version !== '0.0.0'
      ? `v${packageMetadata.version}`
      : null
  }
}

const buildTimestamp = resolveBuildTimestamp()
const buildRevision = resolveBuildRevision()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_ADIMARI_BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
    'import.meta.env.VITE_ADIMARI_BUILD_REVISION': JSON.stringify(buildRevision),
  },
  server: {
    host: true, // Expose server to the local network
    port: 5173, // Optional: specify the port (default is 5173)
    proxy: {
      // Keeps the future NAS explorer on the Adimari origin during development.
      // The proxy removes this public prefix before forwarding to File Sync.
      '/file-sync-api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/file-sync-api/, ''),
      },
    },
  },
})
