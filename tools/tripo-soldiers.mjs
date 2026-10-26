// Official international API only. Secrets are read from env or stdin, never persisted.
import fs from 'node:fs/promises';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export const API = 'https://openapi.tripo3d.ai/v3';
const planURL = new URL('./soldier-model-plan.json', import.meta.url);
const stateURL = new URL('./soldier-model-jobs.json', import.meta.url);
const stages = ['generation', 'check', 'rig', 'animation'];
const routes = { generation: '/generation/text-to-model', check: '/animations/rig-check', rig: '/animations/rig', animation: '/animations/retarget' };
// Node >= 24.5 / 22.21. TLS validation stays enabled, including inside proxy tunnels.
export function apiRequest(key, route, body, { proxy } = {}) {
  if (!/^\/(account\/balance|tasks\/[A-Za-z0-9_-]+|generation\/text-to-model|animations\/(rig-check|rig|retarget))$/.test(route)) throw new Error('Unsupported API route');
  const proxyEnv = proxy ? { HTTPS_PROXY: proxy } : (typeof process !== 'undefined' ? process.env : {});
  const agent = new https.Agent({ proxyEnv });
  return new Promise((resolve, reject) => {
    const finish = (error, result) => { clearTimeout(timer); agent.destroy(); error ? reject(error) : resolve(result); };
    const req = https.request(API + route, { agent, method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    }, res => {
      let output = '';
      res.on('data', data => { output += data; });
      res.on('error', () => finish(new Error('Official API response interrupted')));
      res.on('end', () => {
        let result;
        try { result = JSON.parse(output); } catch { return finish(new Error(`Official Tripo returned non-JSON (HTTP ${res.statusCode})`)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || result.code !== 0) {
          const error = new Error(`Official Tripo rejected request (HTTP ${res.statusCode}, API ${result.code})`);
          error.rejected = true;
          return finish(error);
        }
        finish(null, result.data);
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 90000);
    req.on('error', () => finish(new Error('Official Tripo connection failed; check DNS / HTTPS_PROXY')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

export function payload(plan, character, stage, jobs) {
  if (stage === 'generation') return { ...plan.generation, prompt: character.prompt + ' ' + plan.sharedPrompt };
  if (stage === 'check') return { input: jobs.generation.taskId };
  if (stage === 'rig') return { ...plan.rig, input: jobs.generation.taskId };
  return { ...plan.animation, input: jobs.rig.taskId };
}

// One bounded pass. Unknown POST outcomes deliberately require reconciliation:
// repeating the command must never silently submit a paid task twice.
export async function advance(plan, state, request, save, log = console.log) {
  for (const character of plan.characters) {
    const jobs = state.characters[character.id] ||= {};
    for (const stage of stages) {
      let job = jobs[stage];
      if (!job) {
        job = jobs[stage] = { status: 'submitting', submittedAt: new Date().toISOString() };
        await save();
        try {
          const result = await request(routes[stage], payload(plan, character, stage, jobs));
          if (!result?.task_id) throw new Error('Official API did not return a task ID');
          job.taskId = result.task_id; job.status = 'queued';
          await save();
          log(`${character.id}/${stage}: queued (${job.taskId})`);
        } catch (error) {
          job.status = error.rejected ? 'rejected' : 'submission-unknown';
          await save();
          throw error;
        }
        break;
      }
      if (!job.taskId) throw new Error(`${character.id}/${stage}: ${job.status}; reconcile in the official console before retrying`);
      if (job.status !== 'success') {
        if (['failed', 'cancelled'].includes(job.status)) throw new Error(`${character.id}/${stage}: ${job.status}`);
        const result = await request('/tasks/' + encodeURIComponent(job.taskId));
        job.status = result.status; job.progress = result.progress;
        if (result.credits_consumed !== undefined) job.credits = result.credits_consumed;
        if (stage === 'check' && result.status === 'success') job.riggable = result.output?.riggable === true;
        if (result.error_code !== undefined) job.errorCode = result.error_code;
        await save();
        log(`${character.id}/${stage}: ${job.status} ${job.progress ?? ''}`);
        if (['failed', 'cancelled'].includes(job.status)) throw new Error(`${character.id}/${stage}: ${job.status}`);
        if (job.status !== 'success') break;
      }
      if (stage === 'check' && !job.riggable) throw new Error(`${character.id}: model is not riggable; inspect before spending on rigging`);
    }
  }
  return plan.characters.every(c => state.characters[c.id]?.animation?.status === 'success');
}

async function main() {
  const plan = JSON.parse(await fs.readFile(planURL, 'utf8'));
  if (plan.apiBase !== API) throw new Error('Only the official international endpoint is allowed');
  for (const c of plan.characters) if ((c.prompt + ' ' + plan.sharedPrompt).length > 1024) throw new Error(c.id + ': prompt exceeds API limit');
  let key = process.env.TRIPO_API_KEY?.trim();
  if (process.argv.includes('--key-stdin')) {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    key = Buffer.concat(chunks).toString().trim();
  }
  if (!key || !/^tsk_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Supply TRIPO_API_KEY or --key-stdin');
  const request = (route, body) => apiRequest(key, route, body);
  await request('/account/balance'); // No state is mutated if connectivity/auth fails.
  console.log('Official API connection and authentication verified.');
  if (process.argv.includes('--check')) return;
  let state;
  try { state = JSON.parse(await fs.readFile(stateURL, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; state = { apiBase: API, characters: {} }; }
  if (state.apiBase !== API) throw new Error('State belongs to a different provider');
  const lockURL = new URL('./soldier-model-jobs.lock', import.meta.url);
  const lock = await fs.open(lockURL, 'wx');
  const save = async () => {
    const tmp = new URL('./soldier-model-jobs.json.tmp', import.meta.url);
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
    await fs.rename(tmp, stateURL);
  };
  try {
    do {
      if (await advance(plan, state, request, save)) {
        console.log('Both official rigged animation tasks succeeded. Retrieve outputs with GET /tasks/{task_id}, then inspect and integrate GLBs.');
        return;
      }
      if (!process.argv.includes('--watch')) return;
      await new Promise(resolve => setTimeout(resolve, 20000));
    } while (true);
  } finally { await lock.close(); await fs.unlink(lockURL); }
}

if (typeof process !== 'undefined' && process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
