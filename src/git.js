import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { UserFacingError } from './errors.js';

const execFileAsync = promisify(execFile);

export async function collectGitFacts({ repo, range, fallbackRange, maxDiffChars }) {
  await assertGitRepo(repo);

  let effectiveRange = range;
  const warnings = [];

  try {
    await runGit(repo, ['diff', '--quiet', '--exit-code', range]);
  } catch (error) {
    if (error.gitExitCode && error.gitExitCode !== 1) {
      effectiveRange = fallbackRange;
      warnings.push(`Could not use range \`${range}\`; fell back to \`${fallbackRange}\`.`);
    }
  }

  const [nameStatus, stat, fullDiff, commits] = await Promise.all([
    runGit(repo, ['diff', '--name-status', '--find-renames', effectiveRange]),
    runGit(repo, ['diff', '--stat', '--find-renames', effectiveRange]),
    runGit(repo, ['diff', '--unified=40', '--find-renames', effectiveRange]),
    runGit(repo, ['log', '--oneline', '--no-merges', effectiveRange]).catch(() => ''),
  ]);

  const changedFiles = parseNameStatus(nameStatus);
  const diffExcerpt = truncateDiff(fullDiff, maxDiffChars);

  return {
    repo,
    requestedRange: range,
    range: effectiveRange,
    warnings,
    changedFiles,
    stats: stat.trim(),
    commits: commits.trim(),
    diff: fullDiff,
    diffExcerpt,
    diffTruncated: fullDiff.length > diffExcerpt.length,
  };
}

async function assertGitRepo(repo) {
  try {
    await runGit(repo, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new UserFacingError(`${repo} is not a git repository`);
  }
}

export async function runGit(repo, args) {
  const runner = gitRunnerFor(repo);

  try {
    const { stdout } = await execFileAsync(runner.command, [...runner.prefixArgs, ...args], {
      cwd: runner.cwd,
      encoding: 'utf8',
      maxBuffer: 30 * 1024 * 1024,
      windowsHide: true,
    });

    return stdout;
  } catch (error) {
    const wrapped = new Error(error.stderr?.trim() || error.message);
    wrapped.gitExitCode = error.code;
    throw wrapped;
  }
}

function gitRunnerFor(repo) {
  const wslPath = parseWslPath(repo);

  if (wslPath) {
    return {
      command: 'wsl.exe',
      prefixArgs: ['-d', wslPath.distro, '--cd', wslPath.linuxPath, 'git'],
      cwd: undefined,
    };
  }

  if (process.platform === 'win32' && repo.startsWith('/')) {
    return {
      command: 'wsl.exe',
      prefixArgs: ['--cd', repo, 'git'],
      cwd: undefined,
    };
  }

  return {
    command: 'git',
    prefixArgs: [],
    cwd: repo,
  };
}

function parseWslPath(repo) {
  const match = repo.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$/i);

  if (!match) {
    return null;
  }

  return {
    distro: match[1],
    linuxPath: `/${match[2].replace(/\\/g, '/')}`,
  };
}

function parseNameStatus(raw) {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0];

      if (status.startsWith('R') || status.startsWith('C')) {
        return {
          status,
          path: parts[2],
          previousPath: parts[1],
        };
      }

      return {
        status,
        path: parts[1],
      };
    });
}

function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) {
    return diff;
  }

  const headBudget = Math.floor(maxChars * 0.72);
  const tailBudget = maxChars - headBudget;

  return [
    diff.slice(0, headBudget),
    '\n\n[... diff truncated for AI prompt budget ...]\n\n',
    diff.slice(diff.length - tailBudget),
  ].join('');
}
