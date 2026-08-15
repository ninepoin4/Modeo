/**
 * 原子文件写入（DSH atomic-write 借鉴，2026-08-15）：
 * 同目录临时文件 + rename 覆盖——崩溃时不会留下半截 JSON，
 * 且 rename 在同一文件系统内是原子的（Windows 上 libuv 用 MOVEFILE_REPLACE_EXISTING）。
 * 零依赖，~25 行。
 */
import fs from 'node:fs';
import path from 'node:path';

export function atomicWriteFileSync(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
