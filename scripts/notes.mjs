// A release's notes (docs/specs/11-release.md § Deploy and release): the
// titles of the PRs merged into main since the last tag, from git's own
// merge commits. `node scripts/notes.mjs <tag>` prints Markdown; the release
// workflow passes it to the GitHub Release.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RS = '\x1e', US = '\x1f';

// `log`: `git log --first-parent --format=%s%x1f%b%x1e`. One line per PR,
// oldest first: "- Title (#123)". Commits that aren't PR merges are left out.
export function notesFrom(log, tag, previous) {
  const lines = [];
  for (const rec of log.split(RS)) {
    const [subject = '', body = ''] = rec.replace(/^\s+/, '').split(US);
    const m = /^Merge pull request #(\d+)/.exec(subject);
    if (!m) continue;
    const title = body.split('\n').map(s => s.trim()).find(Boolean) || subject;
    lines.push(`- ${title} (#${m[1]})`);
  }
  lines.reverse();
  const head = `## Stompy ${tag}\n\n${previous ? `Since ${previous}:` : 'Everything so far:'}\n\n`;
  return head + (lines.length ? lines.join('\n') : '- Small fixes.') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] || 'HEAD';
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let previous = '';
  try { previous = git('describe', '--tags', '--abbrev=0', `${tag}^`); } catch { /* the first tag */ }
  const log = git('log', '--first-parent', `--format=%s${US}%b${RS}`, previous ? `${previous}..${tag}` : tag);
  process.stdout.write(notesFrom(log, tag, previous));
}
