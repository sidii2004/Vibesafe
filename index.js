const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');

async function run() {
  try {
    // 1. Get changed code
    const diff = execSync('git diff HEAD~1 HEAD').toString().slice(0, 8000);

    if (!diff) {
      console.log('No changes detected. Skipping scan.');
      return;
    }

    // 2. Send to Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': core.getInput('anthropic_api_key'),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a security reviewer explaining code to someone who cannot read code.

Analyze this code diff and respond in exactly this format:

**WHAT THIS CODE DOES**
One paragraph. Plain English. No technical jargon. Explain it like the person is 12.

**WHAT IT TOUCHES**
Only list what applies: Authentication, Payments, Database, User Data, External APIs, File System

**RISK LEVEL**
One word only: LOW, MEDIUM, or HIGH

**RISKS**
For each risk: explain what could go wrong and what a real attacker could do as a consequence. No jargon. Maximum 3 risks.

Code diff:
${diff}`
        }]
      })
    });

    const data = await response.json();
    const report = data.content[0].text;

    // 3. Post as PR comment
    const token = process.env.GITHUB_TOKEN;
    const octokit = github.getOctokit(token);
    const context = github.context;

    if (context.payload.pull_request) {
      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: context.payload.pull_request.number,
        body: `## 🛡️ VibeSafe Pre-Deploy Report\n\n${report}\n\n---\n*Powered by VibeSafe*`
      });
    }

    // 4. Fail the action if HIGH risk
    if (report.includes('**RISK LEVEL**\nHIGH') || report.includes('RISK LEVEL\nHIGH')) {
      core.setFailed('🚨 HIGH risk detected. Review the VibeSafe report before deploying.');
    }

  } catch (error) {
    core.setFailed(`VibeSafe error: ${error.message}`);
  }
}

run();
