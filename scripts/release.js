#!/usr/bin/env node
'use strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFileSync } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const readline = require('readline');

const DEV_BRANCH = process.env.WAHA_DEV_BRANCH || 'dev';
const CORE_BRANCH = process.env.WAHA_CORE_BRANCH || 'core';
const PLUS_BRANCH = process.env.WAHA_PLUS_BRANCH || 'plus';

const CORE_PREFIX = '[core]';
const PLUS_PREFIX = '[PLUS]';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const assumeYes = args.includes('--yes') || args.includes('-y');

function git(gitArgs, options) {
  const opts = options || {};
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function gitOut(gitArgs) {
  return git(gitArgs, { inherit: false }).trim();
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ensureCleanTree() {
  const status = gitOut(['status', '--porcelain']);
  if (status) {
    fail(
      'Working tree is not clean. Commit or stash your changes before releasing.',
    );
  }
}

function ensureBranchExists(branch) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  } catch {
    fail(`Branch "${branch}" does not exist locally.`);
  }
}

// Non-merge commits in `boundary..head`, oldest first, whose subject starts
// with prefix. The boundary is the last-released plus tip: dev is rebased onto
// plus every release, so `plus..dev` is exactly the new, unreleased work.
// We intentionally do not use `git cherry` (patch-id matching) because core is
// a rewritten history whose old commits share no patch-ids with dev.
function commitsToCherryPick(boundary, head, prefix) {
  const format = '%H%x09%s';
  const output = gitOut([
    'rev-list',
    '--reverse',
    '--no-merges',
    `--format=${format}`,
    `${boundary}..${head}`,
  ]);
  if (!output) {
    return [];
  }
  const picks = [];
  for (const line of output.split('\n')) {
    // rev-list --format prefixes each entry with a "commit <sha>" header line.
    if (!line || line.startsWith('commit ')) {
      continue;
    }
    const tab = line.indexOf('\t');
    const sha = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    if (subject.startsWith(prefix)) {
      picks.push({ sha: sha, subject: subject });
    }
  }
  return picks;
}

function cherryPickAll(picks) {
  for (const pick of picks) {
    log(`  cherry-pick ${pick.sha.slice(0, 9)} ${pick.subject}`);
    if (dryRun) {
      continue;
    }
    try {
      git(['cherry-pick', pick.sha], { inherit: true });
    } catch {
      git(['cherry-pick', '--abort'], { inherit: true });
      fail(
        `Cherry-pick of ${pick.sha.slice(0, 9)} failed (conflict). ` +
          `Aborted the cherry-pick — resolve manually and re-run.`,
      );
    }
  }
}

function checkout(branch) {
  log(`\n→ checkout ${branch}`);
  if (!dryRun) {
    git(['checkout', branch], { inherit: true });
  }
}

function confirm(question) {
  if (assumeYes || dryRun) {
    return Promise.resolve(true);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(function resolver(resolve) {
    rl.question(`${question} [y/N] `, function onAnswer(answer) {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  ensureCleanTree();
  [DEV_BRANCH, CORE_BRANCH, PLUS_BRANCH].forEach(ensureBranchExists);

  const startBranch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);

  if (dryRun) {
    log('Running in --dry-run mode: no branches will be modified.\n');
  }

  // Capture the last-released plus tip before we touch anything. Step 3 merges
  // core into plus and moves the branch, so both pick sets must be computed
  // against this saved boundary, not the live plus ref.
  const boundary = gitOut(['rev-parse', PLUS_BRANCH]);
  log(`Boundary (last released ${PLUS_BRANCH}): ${boundary.slice(0, 9)}\n`);

  const corePicks = commitsToCherryPick(boundary, DEV_BRANCH, CORE_PREFIX);
  log(
    `Found ${corePicks.length} "${CORE_PREFIX}" commit(s) in ` +
      `${DEV_BRANCH} since last ${PLUS_BRANCH} release.`,
  );

  // Step 1 + 2: bring missing [core] commits onto core.
  checkout(CORE_BRANCH);
  cherryPickAll(corePicks);

  // Step 3: merge the freshly updated core into plus.
  checkout(PLUS_BRANCH);
  log(`\n→ merge ${CORE_BRANCH} into ${PLUS_BRANCH}`);
  if (!dryRun) {
    try {
      git(['merge', '--no-edit', CORE_BRANCH], { inherit: true });
    } catch {
      git(['merge', '--abort'], { inherit: true });
      fail(
        `Merge of ${CORE_BRANCH} into ${PLUS_BRANCH} failed (conflict). ` +
          `Aborted the merge — resolve manually and re-run.`,
      );
    }
  }

  // Step 4: bring missing [PLUS] commits onto plus (same saved boundary).
  const plusPicks = commitsToCherryPick(boundary, DEV_BRANCH, PLUS_PREFIX);
  log(
    `\nFound ${plusPicks.length} "${PLUS_PREFIX}" commit(s) in ` +
      `${DEV_BRANCH} since last ${PLUS_BRANCH} release.`,
  );
  cherryPickAll(plusPicks);

  // Step 5: rebase dev onto the freshly built plus.
  log(`\n→ rebase ${DEV_BRANCH} onto ${PLUS_BRANCH} (rewrites ${DEV_BRANCH})`);
  const proceed = await confirm(
    `This will force-rewrite "${DEV_BRANCH}". Continue?`,
  );
  if (!proceed) {
    fail('Aborted before rebasing dev. core/plus changes are kept.');
  }
  checkout(DEV_BRANCH);
  if (!dryRun) {
    try {
      git(['rebase', PLUS_BRANCH], { inherit: true });
    } catch {
      git(['rebase', '--abort'], { inherit: true });
      fail(
        `Rebase of ${DEV_BRANCH} onto ${PLUS_BRANCH} failed (conflict). ` +
          `Aborted the rebase — resolve manually and re-run.`,
      );
    }
  }

  if (dryRun) {
    checkout(startBranch);
    log('\nDry run complete. Re-run without --dry-run to apply.');
  } else {
    log(
      `\n✓ Release complete. ${DEV_BRANCH} now sits on top of ${PLUS_BRANCH}.`,
    );
    log(
      `  Push when ready: git push origin ${CORE_BRANCH} ${PLUS_BRANCH} ` +
        `&& git push --force-with-lease origin ${DEV_BRANCH}`,
    );
  }
}

main().catch(function onError(error) {
  fail(error.message || String(error));
});
