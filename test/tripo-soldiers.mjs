// Offline checks: no API keys, no network requests, no generation charges.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { advance, payload, API } from '../tools/tripo-soldiers.mjs';
const plan = JSON.parse(await fs.readFile(new URL('../tools/soldier-model-plan.json', import.meta.url)));
assert.equal(plan.apiBase, API);
for (const c of plan.characters) assert.ok(payload(plan, c, 'generation', {}).prompt.length <= 1024);
const state = { characters: {} }, tasks = new Map();
let posts = 0, saves = 0;
const save = async () => { saves++; };
const log = () => {};
const request = async (route, body) => {
  if (body) {
    if (body.input) assert.ok(tasks.has(body.input), 'dependent task must reference a real previous task');
    const id = 'task_test' + (++posts);
    tasks.set(id, { status: 'running', progress: 20, output: { riggable: true } });
    return { task_id: id };
  }
  return tasks.get(route.split('/').pop());
};
assert.equal(await advance(plan, state, request, save, log), false);
assert.equal(posts, 2);
await advance(plan, state, request, save, log);
assert.equal(posts, 2, 'polling does not resubmit generation');
for (let pass = 0; pass < 4; pass++) {
  for (const task of tasks.values()) task.status = 'success';
  await advance(plan, state, request, save, log);
}
assert.equal(posts, 8, 'two models, each generation + check + rig + animation');
assert.equal(await advance(plan, state, request, save, log), true);
assert.equal(posts, 8, 'completed runs are idempotent');
assert.ok(saves >= 16);

const unknown = { characters: {} };
await assert.rejects(advance(plan, unknown, async () => { throw new Error('timeout'); }, save, log), /timeout/);
assert.equal(unknown.characters.bl.generation.status, 'submission-unknown');
let retried = false;
await assert.rejects(advance(plan, unknown, async () => { retried = true; }, save, log), /reconcile/);
assert.equal(retried, false, 'unknown submissions must not spend twice');

const badRig = { characters: { bl: {
  generation: { status: 'success', taskId: 'task_generated' },
  check: { status: 'queued', taskId: 'task_check' },
} } };
await assert.rejects(advance(plan, badRig, async () => ({ status: 'success', output: { riggable: false } }), save, log), /not riggable/);
assert.equal(badRig.characters.bl.rig, undefined, 'incompatible model must not start paid rigging');
console.log('PASS: prompts, dependencies, polling, resume, duplicate-charge prevention, rig-check gate (offline).');
