// E2E smoke test for the Control Center API — in-process server, real gateway.
import 'dotenv/config';
process.env.FACTORY_DB = ':memory:';
process.env.OMNIROUTE_URL = 'http://127.0.0.1:20128';

const { startServer } = await import('../src/server.js');
const server = startServer();
const BASE = 'http://127.0.0.1:8787';

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function post(path, data) {
  return j(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  });
}

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function main() {
  console.log('== GET /api/dashboard ==');
  let r = await j('/api/dashboard');
  check('dashboard 200', r.status === 200);

  console.log('== GET /api/agents ==');
  r = await j('/api/agents');
  check('agents 200', r.status === 200);
  check('4 agents', r.body.agents?.length === 4);

  console.log('== POST /api/content (create idea) ==');
  r = await post('/api/content', { topic: 'a brave turtle learns to swim' });
  check('create 201', r.status === 201);
  const cid = r.body.id;
  check('has content id', !!cid);

  console.log('== POST /api/pipeline/:id/start ==');
  r = await post(`/api/pipeline/${cid}/start`);
  check('start 200', r.status === 200);
  const startJob = r.body.jobId;
  check('start returns job', !!startJob);

  console.log('== POST /api/jobs/run (research -> gate) ==');
  r = await post('/api/jobs/run');
  check('run 200', r.status === 200);

  console.log('== GET /api/approvals (research idea gate) ==');
  r = await j('/api/approvals');
  check('has pending approval', (r.body.approvals ?? []).length >= 1);
  const app = r.body.approvals?.[0];
  check('approval kind idea', app?.kind === 'idea', JSON.stringify(app));

  console.log('== content status after research ==');
  r = await j(`/api/content/${cid}`);
  check('status RESEARCHED', r.body.content?.status === 'RESEARCHED', r.body.content?.status);
  check('idea artifact v1', (r.body.artifacts ?? []).some((a) => a.kind === 'idea' && a.version === 1));

  console.log('== POST approve === pipe script -> director -> qa');
  r = await post(`/api/approvals/${app?.id}/decide`, { status: 'APPROVED', decision: 'ok' });
  check('decide 200', r.status === 200);

  // Now script gate
  r = await j('/api/approvals');
  const app2 = r.body.approvals?.[0];
  check('script approval pending', app2?.kind === 'script', JSON.stringify(app2));
  await post(`/api/approvals/${app2?.id}/decide`, { status: 'APPROVED' });

  // director gate
  r = await j('/api/approvals');
  const app3 = r.body.approvals?.[0];
  check('plan approval pending', app3?.kind === 'plan', JSON.stringify(app3));
  await post(`/api/approvals/${app3?.id}/decide`, { status: 'APPROVED' });

  console.log('== final content state ==');
  r = await j(`/api/content/${cid}`);
  const content = r.body.content;
  check('final status QA', content?.status === 'QA', content?.status);
  const kinds = (r.body.artifacts ?? []).map((a) => `${a.kind} v${a.version}`);
  check('all 4 artifacts', kinds.includes('idea v1') && kinds.includes('script v1') && kinds.includes('production_plan v1') && kinds.includes('qa v1'), kinds.join(', '));
  const qaCount = (r.body.artifacts ?? []).filter((a) => a.kind === 'qa')[0];
  const qaPayload = qaCount?.payload;
  check('qa verdict approved', qaPayload?.status === 'approved', JSON.stringify(qaPayload));
  const totCost = (r.body.jobs ?? []).reduce((s, jj) => s + (jj.costEur ?? 0), 0);
  console.log(`  cost rollup: €${totCost.toFixed(4)}`);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('SMOKE ERROR:', e);
  server.close();
  process.exit(1);
});
