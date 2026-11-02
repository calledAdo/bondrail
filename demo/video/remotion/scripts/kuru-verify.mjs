import {execFileSync} from 'node:child_process';
import path from 'node:path';
const python=process.env.BONDRAIL_VIDEO_PYTHON??'/private/tmp/bondrail-kuru-venv/bin/python';
execFileSync(python,[path.join(import.meta.dirname,'kuru-verify.py')],{stdio:'inherit'});
