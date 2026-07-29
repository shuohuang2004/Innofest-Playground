const FROZEN_LEGACY_PATHS = [
  'app/decorators/cb/series/',
  'app/lib/cb/series/',
  'test/unit/cb/series/',
];

const CATEGORY_RULES = [
  ['controllers', /^app\/controllers\//],
  ['services', /^app\/services\//],
  ['models', /^app\/models\//],
  ['migrations', /^(db\/migrate\/|migrations\/)/],
  ['routes', /^config\/routes\.rb$/],
  ['tests', /(^test\/|^spec\/|_test\.rb$|_spec\.rb$|\.test\.[jt]sx?$|\.spec\.[jt]sx?$)/],
  ['docs', /(^docs\/|README|redocly\.ya?ml$|openapi|swagger)/i],
  ['dependencies', /^(Gemfile|Gemfile\.lock|package\.json|yarn\.lock|package-lock\.json)$/],
  ['ci', /^(\.circleci\/|\.github\/workflows\/|\.github\/actions\/)/],
];

const CLAIM_PATTERNS = [
  {
    id: 'refactor_only',
    label: 'Claims refactor/cleanup only',
    pattern: /\b(refactor|cleanup|clean\s*up|rename|extract|organize|tidy)\b/i,
  },
  {
    id: 'docs_only',
    label: 'Claims docs-only work',
    pattern: /\b(only|just|purely)\s+(docs?|documentation|readme)\b|\b(docs?|documentation|readme)[-\s]+only\b/i,
  },
  {
    id: 'test_only',
    label: 'Claims test-only work',
    pattern: /\b(only|just|purely)\s+(tests?|specs?|coverage)\b|\b(tests?|specs?|coverage)[-\s]+only\b/i,
  },
  {
    id: 'no_behavior_change',
    label: 'Claims no behavior change',
    pattern: /\b(no behavior change|no behavioural change|behavior unchanged|behaviour unchanged|non[- ]?functional)\b/i,
  },
  {
    id: 'small_change',
    label: 'Frames the PR as small/simple',
    pattern: /\b(small|minor|simple|tiny|quick|just|only)\b/i,
  },
];

const BEHAVIOR_LINE_PATTERN =
  /^\s*[+-]\s*(if|unless|elsif|else|case|when|return|render|redirect_to|raise|rescue|where|find_by|update!?|create!?|destroy!?|save!?|validates?|before_action|skip_before_action|authorize|authenticate|current_user|admin\?|policy|scope|enqueue|perform_later)\b/i;

const ASSERTION_LINE_PATTERN =
  /^\s*-\s*(assert|refute|expect|must_|wont_|should|it\s+['"`]|test\s+['"`])/i;

export function scanRules({ title, body, gitFacts }) {
  const changedFiles = gitFacts.changedFiles;
  const paths = changedFiles.map((file) => file.path);
  const categories = categorizePaths(paths);
  const claims = detectClaims(`${title}\n\n${body}`);
  const behaviorSignals = detectBehaviorSignals(gitFacts.diff);
  const deletedAssertions = detectDeletedAssertions(gitFacts.diff);
  const signals = [];

  if (categories.frozenLegacy.length > 0) {
    signals.push({
      id: 'frozen_legacy_touched',
      severity: 'high',
      title: 'Frozen legacy code touched',
      detail: 'This repo marks Cb::Series paths as read-only dependencies.',
      evidence: categories.frozenLegacy,
    });
  }

  if (categories.migrations.length > 0) {
    signals.push({
      id: 'migration_changed',
      severity: 'high',
      title: 'Database migration changed',
      detail: 'PR description should call out rollout and rollback risk.',
      evidence: categories.migrations,
    });
  }

  if ((categories.controllers.length > 0 || categories.routes.length > 0) && categories.docs.length === 0) {
    signals.push({
      id: 'api_surface_without_docs',
      severity: 'medium',
      title: 'API/controller surface changed without docs changes',
      detail: 'Reviewer should confirm whether API docs or request specs need updates.',
      evidence: [...categories.routes, ...categories.controllers].slice(0, 8),
    });
  }

  if (categories.services.length > 0 && categories.tests.length === 0) {
    signals.push({
      id: 'service_without_tests',
      severity: 'medium',
      title: 'Service code changed without tests',
      detail: 'Service changes often need focused unit/service tests or a verification note.',
      evidence: categories.services.slice(0, 8),
    });
  }

  if (categories.controllers.length > 0 && categories.tests.length === 0) {
    signals.push({
      id: 'controller_without_tests',
      severity: 'medium',
      title: 'Controller code changed without tests',
      detail: 'Controller changes can alter status codes, permissions, params, or response shape.',
      evidence: categories.controllers.slice(0, 8),
    });
  }

  if (categories.dependencies.length > 0) {
    signals.push({
      id: 'dependencies_changed',
      severity: 'medium',
      title: 'Dependencies changed',
      detail: 'Dependency changes should include compatibility and security notes.',
      evidence: categories.dependencies,
    });
  }

  if (behaviorSignals.length > 0) {
    signals.push({
      id: 'behavior_signals',
      severity: 'medium',
      title: 'Diff contains behavior-change signals',
      detail: 'Conditional, return, query, validation, auth, or persistence lines changed.',
      evidence: behaviorSignals.slice(0, 8),
    });
  }

  if (deletedAssertions.length > 0) {
    signals.push({
      id: 'deleted_assertions',
      severity: 'medium',
      title: 'Test assertions were removed',
      detail: 'Removed assertions can weaken the PR alibi even when CI passes.',
      evidence: deletedAssertions.slice(0, 8),
    });
  }

  if (categories.ci.length > 0) {
    signals.push({
      id: 'ci_changed',
      severity: 'low',
      title: 'CI/CD configuration changed',
      detail: 'Reviewer should check pipeline behavior, required checks, and secrets assumptions.',
      evidence: categories.ci,
    });
  }

  const mismatches = detectRuleBasedMismatches({ claims, categories, behaviorSignals, signals });
  const truthScore = scoreTruth({ mismatches, signals });
  const riskLevel = scoreToRisk(truthScore, signals, mismatches);

  return {
    categories,
    claims,
    behaviorSignals,
    deletedAssertions,
    signals,
    mismatches,
    truthScore,
    riskLevel,
    ruleVerdict: verdictFor({ truthScore, mismatches, signals }),
  };
}

function categorizePaths(paths) {
  const categories = Object.fromEntries(CATEGORY_RULES.map(([name]) => [name, []]));
  categories.other = [];
  categories.frozenLegacy = [];

  for (const path of paths) {
    let matched = false;

    for (const [name, pattern] of CATEGORY_RULES) {
      if (pattern.test(path)) {
        categories[name].push(path);
        matched = true;
      }
    }

    if (FROZEN_LEGACY_PATHS.some((prefix) => path.startsWith(prefix))) {
      categories.frozenLegacy.push(path);
    }

    if (!matched) {
      categories.other.push(path);
    }
  }

  return categories;
}

function detectClaims(text) {
  return CLAIM_PATTERNS
    .filter((claim) => claim.pattern.test(text))
    .map(({ id, label }) => ({
      id,
      label,
    }));
}

function detectBehaviorSignals(diff) {
  const signals = [];
  let currentFile = '';

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' b/')[1] || currentFile;
      continue;
    }

    if (BEHAVIOR_LINE_PATTERN.test(line)) {
      signals.push(`${currentFile}: ${line.slice(0, 160)}`);
    }
  }

  return signals;
}

function detectDeletedAssertions(diff) {
  const assertions = [];
  let currentFile = '';

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' b/')[1] || currentFile;
      continue;
    }

    if (ASSERTION_LINE_PATTERN.test(line)) {
      assertions.push(`${currentFile}: ${line.slice(0, 160)}`);
    }
  }

  return assertions;
}

function detectRuleBasedMismatches({ claims, categories, behaviorSignals, signals }) {
  const claimIds = new Set(claims.map((claim) => claim.id));
  const mismatches = [];
  const codeFilesChanged =
    categories.controllers.length +
      categories.services.length +
      categories.models.length +
      categories.migrations.length +
      categories.routes.length >
    0;

  if (
    (claimIds.has('refactor_only') || claimIds.has('no_behavior_change')) &&
    (behaviorSignals.length > 0 || categories.controllers.length > 0 || categories.routes.length > 0 || categories.migrations.length > 0)
  ) {
    mismatches.push({
      id: 'refactor_claim_but_behavior_signals',
      severity: 'high',
      claim: 'PR is framed as refactor/cleanup/no behavior change.',
      reality: 'Diff contains behavior-change signals or touches request/route/database surface.',
      evidence: [
        ...behaviorSignals.slice(0, 4),
        ...categories.routes.slice(0, 2),
        ...categories.controllers.slice(0, 2),
        ...categories.migrations.slice(0, 2),
      ],
    });
  }

  if (claimIds.has('docs_only') && codeFilesChanged) {
    mismatches.push({
      id: 'docs_claim_but_code_changed',
      severity: 'high',
      claim: 'PR appears to be framed around docs.',
      reality: 'Application code or database files changed too.',
      evidence: [
        ...categories.controllers,
        ...categories.services,
        ...categories.models,
        ...categories.migrations,
        ...categories.routes,
      ].slice(0, 8),
    });
  }

  if (claimIds.has('test_only') && codeFilesChanged) {
    mismatches.push({
      id: 'test_claim_but_code_changed',
      severity: 'medium',
      claim: 'PR appears to be framed around tests.',
      reality: 'Application code or database files changed too.',
      evidence: [
        ...categories.controllers,
        ...categories.services,
        ...categories.models,
        ...categories.migrations,
        ...categories.routes,
      ].slice(0, 8),
    });
  }

  if (claimIds.has('small_change') && signals.some((signal) => signal.severity === 'high')) {
    mismatches.push({
      id: 'small_claim_but_high_risk',
      severity: 'medium',
      claim: 'PR language makes the change sound small.',
      reality: 'High-risk signals are present.',
      evidence: signals.filter((signal) => signal.severity === 'high').map((signal) => signal.title),
    });
  }

  return mismatches;
}

function scoreTruth({ mismatches, signals }) {
  const penalties = {
    high: 22,
    medium: 11,
    low: 5,
  };

  const mismatchPenalty = mismatches.reduce((sum, mismatch) => sum + penalties[mismatch.severity], 0);
  const signalPenalty = signals.reduce((sum, signal) => sum + Math.floor(penalties[signal.severity] / 2), 0);

  return Math.max(0, 100 - mismatchPenalty - signalPenalty);
}

function scoreToRisk(score, signals, mismatches) {
  if (
    signals.some((signal) => signal.severity === 'high') ||
    mismatches.some((mismatch) => mismatch.severity === 'high') ||
    score < 60
  ) {
    return 'high';
  }

  if (score < 82) {
    return 'medium';
  }

  return 'low';
}

function verdictFor({ truthScore, mismatches, signals }) {
  if (mismatches.length > 0) {
    return 'Description may be incomplete. Reviewer should compare the PR claim with the evidence below.';
  }

  if (signals.some((signal) => signal.severity === 'high')) {
    return 'No direct claim mismatch found, but high-risk change signals need explicit PR notes.';
  }

  if (truthScore < 90) {
    return 'Mostly honest, with a few review focus areas.';
  }

  return 'No obvious mismatch found by rule-based checks.';
}
