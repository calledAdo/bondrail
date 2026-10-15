import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/** CRE resolves its login from HOME, which system services must set explicitly. */
export function assertCreCredentials(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  if (!home || !path.isAbsolute(home)) {
    throw new Error('CRE requires an absolute HOME to find $HOME/.cre/cre.yaml. Set HOME=/root for bondrail-covenant.service.');
  }
  const file = path.join(home, '.cre/cre.yaml');
  try {
    if (!statSync(file).isFile()) throw new Error('not a regular file');
    accessSync(file, constants.R_OK);
  } catch {
    throw new Error(`CRE credentials file missing or unreadable: ${file}. Check HOME and run cre login as the service user to restore credentials; no report was sent.`);
  }
  return file;
}
