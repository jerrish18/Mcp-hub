const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.join(repositoryRoot, 'src'), path.join(repositoryRoot, 'node_modules')];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(repositoryRoot, 'node_modules')];
const previousResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const resolvedName = name.startsWith('@core/') ? path.join(repositoryRoot, 'src', name.slice(6)) : name;
  return previousResolver ? previousResolver(context, resolvedName, platform) : context.resolveRequest(context, resolvedName, platform);
};
module.exports = config;
