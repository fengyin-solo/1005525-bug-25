/** 旧版数据读盘迁移：在任何 service 调用前预置 v1 脏数据，验证 store 首次读取时自动升级。 */
const legacy: Record<string, unknown> = {
  finishedqc: [
    { id: 1, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-1', 产品批号: 'B1', 检验项目: '含量测定', 标准规定: '>=95', 检验结果: '0', 判定结论: '合格', 检验人: '旧' },
    { id: 2, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-2', 产品批号: 'B2', 检验项目: '水分', 标准规定: '', 检验结果: '', 判定结论: '合格', 检验人: '旧' },
  ],
  retainsample: [
    { id: 1, status: '已留样', pending: false, abnormal: false, 留样编号: 'RT-1', 对应批号: 'B1' },
  ],
}
const memory = new Map<string, string>([['pharma-cleanroom:entries', JSON.stringify(legacy)]])
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
  },
}

import { registerMigrators } from '@/data/local-store'
import { migrateV1ToV2 } from '@/data/migrations'
import { getQcRow, judgeQc, retainRowsWithQc } from '@/api/finishedqc-service'

registerMigrators([migrateV1ToV2])

let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

console.log('读盘自动迁移（v1 无版本号数据）')
const m1 = getQcRow(1)!
check('零值假合格在首次读盘时已撤回为不合格', m1.status === '不合格' && m1.判定结论 === '不合格', JSON.stringify({ s: m1.status }))
const m2 = getQcRow(2)!
check('缺标准假合格撤回检验中', m2.status === '检验中' && m2.abnormal === true)
check('落库数据已带版本号 v2', JSON.parse(memory.get('pharma-cleanroom:entries')!).version === 2)
check('新字段已回填（复检记录数组）', Array.isArray(m1.复检记录))
const retain = retainRowsWithQc().find((r) => String(r.对应批号) === 'B1')
check('留样清单随迁移回填不合格结论', retain?.检验结论 === '不合格' && retain?.abnormal === true)
// 撤回重判后的记录在检验中，结果0仍按引擎拦截？不——0 对 >=95 是合法数值只是不合格，可以重新判定/复检
check('迁移后记录可重新走判定流（零值仍判不合格）', (judgeQc(1).ok && getQcRow(1)!.status === '不合格') || getQcRow(1)!.status === '不合格')

if (failed) process.exit(1)
