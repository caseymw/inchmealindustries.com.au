import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIT_COMMIT_NAME = process.env.GIT_COMMIT_NAME || 'Inchmeal Publisher';
const GIT_COMMIT_EMAIL = process.env.GIT_COMMIT_EMAIL || 'publisher@inchmealindustries.com.au';
const GIT_REMOTE = process.env.GIT_REMOTE || 'https://github.com/caseymw/inchmealindustries.com.au.git';

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required.');
  process.exit(1);
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function runCapture(cmd, args) {
  return execFileSync(cmd, args, { cwd: REPO_ROOT }).toString().trim();
}

const status = runCapture('git', ['status', '--porcelain', '--', 'site/src/content']);
if (!status) {
  console.log('No content changes to push.');
  process.exit(0);
}

const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

run('git', ['add', 'site/src/content']);
run('git', [
  '-c', `user.name=${GIT_COMMIT_NAME}`,
  '-c', `user.email=${GIT_COMMIT_EMAIL}`,
  'commit', '-m', 'Publish content update',
]);

// Token supplied only on this one command line, never written to .git/config.
const authenticatedRemote = GIT_REMOTE.replace('https://', `https://x-access-token:${GITHUB_TOKEN}@`);
run('git', ['push', authenticatedRemote, `HEAD:${branch}`]);

console.log(`Pushed content update to ${branch}.`);
