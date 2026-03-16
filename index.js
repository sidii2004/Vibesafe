const { execSync } = require('child_process');
const https = require('https');

const apiKey = (process.env.ANTHROPIC_API_KEY_INPUT || '').trim();
const githubToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;

function post(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(data) }
    }, (res) => {
      let out = '';
      res.on('data', chunk => out += chunk);
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const diff = execSync('git diff HEAD~1 HEAD').toString().slice(0, 8000);

  if (!diff) {
    console.log('No changes detected.');
    process.exit(0);
  }

  const result = await post('api.anthropic.com', '/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  }, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are a security reviewer explaining code to someone who cannot read code.

Analyze this code diff and respond in exactly this format:

**WHAT THIS CODE DOES**
One paragraph. Plain English. No jargon.

**WHAT IT TOUCHES**
Only list what applies: Authentication, Payments, Database, User Data, External APIs, File System

**RISK LEVEL**
One word only: LOW, MEDIUM, or HIGH

**RISKS**
For each risk: explain what could go wrong in plain English. Max 3 risks.

Code diff:
${diff}`
    }]
  });

  const report = result.content[0].text;
  console.log(report);

  await post('api.github.com', `/repos/${repo}/issues/${prNumber}/comments`, {
    'Authorization': `Bearer ${githubToken}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'VibeSafe',
    'content-type': 'application/json'
  }, { body: `## 🛡️ VibeSafe Pre-Deploy Report\n\n${report}\n\n---\n*Powered by VibeSafe*` });

  if (report.includes('HIGH')) {
    console.error('HIGH risk detected!');
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
