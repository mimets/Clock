import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const installUtil = join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'installUtil.nsh');

let content = readFileSync(installUtil, 'utf-8');

// Increase retry limit: 5 → 30 (more patience for old uninstaller)
content = content.replace('${if} $R5 > 5', '${if} $R5 > 30');

// Change silent default from Cancel to Retry (keep trying instead of giving up)
content = content.replace('/SD IDCANCEL IDRETRY OneMoreAttempt', '/SD IDRETRY IDRETRY OneMoreAttempt');

writeFileSync(installUtil, content, 'utf-8');
