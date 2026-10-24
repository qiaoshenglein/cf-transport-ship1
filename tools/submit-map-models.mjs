// 只提交作业，不等待生成。每次 POST 前后保存进度，避免重复消耗生成额度。
// 若请求结果不确定，先查 /v1/jobs 核对提示词和作业，切勿直接再次提交。
import fs from 'node:fs/promises';
const manifestPath = new URL('./map-expansion-jobs.json', import.meta.url);
const batch = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const save = () => fs.writeFile(manifestPath, JSON.stringify(batch, null, 2) + '\n');
for (const model of batch.models) {
  if (model.jobId) { console.log(`SKIP ${model.id}: ${model.jobId}`); continue; }
  if (model.submittedAt) throw new Error(`${model.id} 上次提交结果不确定，请先查询 API 作业列表核对`);
  model.submittedAt = new Date().toISOString();
  model.outputName = model.id + '.glb';
  await save();
  try {
    const response = await fetch(batch.apiBase + '/v1/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ mode: 'text', prompt: model.prompt + ' ' + batch.sharedRequirements,
        faceCount: batch.faceCount, asset: 'textured-glb', timeoutSeconds: 3600,
        out: { dir: batch.batch, name: model.outputName } }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.jobId) {
      model.submissionError = result.error || { status: response.status };
      await save(); throw new Error(`${model.id}: ${JSON.stringify(model.submissionError)}`);
    }
    model.jobId = result.jobId; model.status = result.status; model.statusPath = result.links.self;
    await save();
    console.log(`ACCEPTED ${model.id}: ${result.jobId} (${result.status})`);
  } catch (error) {
    model.submissionError = model.submissionError || String(error);
    await save(); throw error;
  }
}
batch.phase = 'submitted-awaiting-user';
await save();
console.log(`已保存 ${batch.models.filter((m) => m.jobId).length} 个作业编号；等待用户通知后再接入地图。`);
