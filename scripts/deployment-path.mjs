import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function deploymentName(value = process.env.BONDRAIL_DEPLOYMENT ?? 'main') {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) throw new Error('Invalid BONDRAIL_DEPLOYMENT');
  return value;
}
export function deploymentPath(root, chainId, name = deploymentName()) {
  deploymentName(name);
  if (!/^[1-9][0-9]*$/.test(String(chainId))) throw new Error('Invalid chain ID');
  return path.join(root, 'docs/deployments', `${chainId}${name === 'main' ? '' : `-${name}`}.json`);
}
export function assertWritable(file, force = process.argv.includes('--force')) {
  if (fs.existsSync(file) && !force) throw new Error(`Refusing to overwrite ${file}; pass --force explicitly`);
}
export function writeJson(file, value, force = process.argv.includes('--force')) {
  assertWritable(file, force);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Exclusive create for new deployments; atomic replacement for explicitly authorized updates.
  if (!force) fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  else {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
  }
}

/** Resolve a key location without reading it. The deployer can be shared across deployments. */
export function roleKeyPath(name, env = process.env, home = os.homedir()) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('Invalid key name');
  const deployment = deploymentName(env.BONDRAIL_DEPLOYMENT ?? 'main');
  const prefix = env.BONDRAIL_KEY_PREFIX ?? (deployment === 'main' ? '' : deployment);
  if (prefix && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(prefix)) throw new Error('Invalid BONDRAIL_KEY_PREFIX');
  const root = env.BONDRAIL_KEY_DIR ?? path.join(home, '.slice');
  return name === 'deployer' ? env.BONDRAIL_DEPLOYER_KEY_FILE ?? path.join(root, 'deployer.key')
    : path.join(root, prefix, `${name}.key`);
}
