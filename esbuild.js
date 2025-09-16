const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['extension.js'],
  bundle: true,
  outdir: 'out',
  platform: 'node',
  target: 'node14',
  external: ['vscode']
}).catch(() => process.exit(1));