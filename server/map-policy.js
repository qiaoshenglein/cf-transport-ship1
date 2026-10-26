// 地图开放配置：默认全开，只有后台显式修改后才落盘。重启保留禁用列表。
import fs from 'node:fs';
import path from 'node:path';
import { MAPS, MAP_IDS } from '../src/maps.js';

export function createMapPolicy(file) {
  const save = (next) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 2, disabled: [...next] }, null, 2) + '\n');
    fs.renameSync(temp, file);
  };
  let disabled = new Set();
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved.disabled) || !saved.disabled.every((x) => typeof x === 'string')) throw new Error('地图配置格式无效：' + file);
    disabled = new Set(saved.disabled.filter((id) => MAP_IDS.includes(id)));
    // v1 使用旧地图目录；删图后原先开放的地图可能已全部下架。
    // 迁移时恢复运输船，之后仍拒绝非法的全禁用配置。
    if (disabled.size === MAP_IDS.length) {
      if (saved.version == null || saved.version === 1) disabled.delete('ship');
      else throw new Error('地图配置必须至少启用一张地图');
    }
    if (saved.version !== 2 || saved.disabled.length !== disabled.size) save(disabled);
  }
  const enabled = (id) => MAP_IDS.includes(id) && !disabled.has(id);
  const list = () => MAP_IDS.map((id) => ({ id, name: MAPS[id].name, desc: MAPS[id].desc, enabled: enabled(id) }));
  return {
    enabled, list,
    pick: (id) => id == null ? MAP_IDS.find(enabled) : enabled(id) ? id : null,
    set(id, value) {
      if (!MAP_IDS.includes(id)) return { err: '地图不存在' };
      if (typeof value !== 'boolean') return { err: 'enabled 必须为布尔值' };
      if (!value && enabled(id) && disabled.size === MAP_IDS.length - 1) return { err: '至少需要保留一张已启用地图' };
      const next = new Set(disabled);
      if (value) next.delete(id); else next.add(id);
      save(next);
      disabled = next;
      return { ok: `已${value ? '启用' : '禁用'}「${MAPS[id].name}」`, note: MAPS[id].name, maps: list() };
    },
  };
}
