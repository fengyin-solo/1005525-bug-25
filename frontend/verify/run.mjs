/**
 * 成品检验修复点的端到端校验脚本（不依赖测试框架）：
 *   npx esbuild 打包后在 Node 中运行，localStorage 用内存桩模拟。
 * 覆盖：同源判定、零值不放行、负数重填、缺标准拦截、状态倒序拒收、
 *       批量断点续跑幂等、复检锁死、复核只算一次、留样联动、存量迁移、列表详情同源。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))

const bundles = [
  { entry: path.join(root, 'entry.ts'), outfile: path.join(root, '.verify-bundle.mjs') },
  { entry: path.join(root, 'entry2.ts'), outfile: path.join(root, '.verify-bundle2.mjs') },
]

for (const item of bundles) {
  await build({
    entryPoints: [item.entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: item.outfile,
    alias: { '@': path.join(root, '..', 'src') },
  })
  await import(item.outfile)
  fs.rmSync(item.outfile, { force: true })
}
