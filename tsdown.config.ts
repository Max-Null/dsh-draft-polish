/**
 * tsdown build for @max-null/dsh-draft-polish: the host-half ESM bundle
 * (lib/index.js, node) plus the browser client bundle (lib/client.js, CJS
 * closure factory registered through window.__ModuleLoader__ — the same
 * protocol dsh-chat-rail uses).
 *
 * The client bundle only value-imports the shared platform module-table words
 * (react, react-dom, cordis); every other @deepseek-ai value import is
 * rejected by the purity gate — collaboration goes through cordis services,
 * and type-only imports are erased before the gate runs.
 */
import type { UserConfig } from 'tsdown'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
]

const purityGate = () => ({
  name: 'dsh-draft-polish-client-purity',
  resolveId(source: string): null {
    if (source.startsWith('@deepseek-ai/')) {
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is a platform package — cross-plugin value imports are forbidden; `
        + 'collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    }
    return null
  },
})

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Bundle schemastery into the host artifact so the plugin never depends on
    // a runtime resolution of the (possibly diverged) schemastery instance.
    noExternal: ['schemastery'],
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGate()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('@max-null/dsh-draft-polish')}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
