import { writeFileSync } from 'node:fs';

import { parseArgs, helpText } from './args.js';
import { collectGitFacts } from './git.js';
import { applyAiScoring, scanRules } from './rules.js';
import { runAiClaimChecker } from './ai.js';
import { buildReport } from './report.js';
import { loadSample } from './samples.js';

export async function main(argv) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(helpText());
    return;
  }

  const sample = options.sample ? loadSample(options.sample) : null;
  const gitFacts = sample ? sample.gitFacts : await collectGitFacts(options);
  const title = options.title || sample?.title || '';
  const body = options.body || sample?.body || '';
  const preliminaryRuleReport = scanRules({
    title,
    body,
    gitFacts,
  });

  const aiReport = options.ai
    ? await runAiClaimChecker({
        title,
        body,
        gitFacts,
        ruleReport: preliminaryRuleReport,
        model: options.model,
      })
    : {
        enabled: false,
        reason: 'AI disabled by --no-ai.',
      };
  const ruleReport = applyAiScoring(preliminaryRuleReport, aiReport);

  const report = buildReport({
    title,
    body,
    gitFacts,
    ruleReport,
    aiReport,
    githubComment: options.githubComment,
  });

  if (options.output) {
    writeFileSync(options.output, report.markdown, 'utf8');
  }

  if (options.jsonOutput) {
    writeFileSync(options.jsonOutput, JSON.stringify(report.json, null, 2), 'utf8');
  }

  if (!options.output) {
    console.log(report.markdown);
  } else {
    console.log(`Wrote PR comment report to ${options.output}`);
  }

  if (!aiReport.enabled && aiReport.reason) {
    console.error(`AI note: ${aiReport.reason}`);
  }
}
