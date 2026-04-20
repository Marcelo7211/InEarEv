// Monorepo: Metro enxerga `packages/` e node_modules da raiz.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const fs = require('fs')
const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

function pkgDir(name) {
  const a = path.join(projectRoot, 'node_modules', name)
  if (fs.existsSync(a)) return a
  const b = path.join(monorepoRoot, 'node_modules', name)
  if (fs.existsSync(b)) return b
  return a
}

config.resolver.extraNodeModules = {
  react: pkgDir('react'),
  'react-native': pkgDir('react-native'),
}

module.exports = config
