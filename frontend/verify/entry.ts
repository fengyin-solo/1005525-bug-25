import { evaluateConclusion } from '@/domain/evaluate'
import {
  batchEvaluate,
  clearBatchCheckpoint,
  createQcReport,
  createRecheck,
  detectIssue,
  fillSpec,
  getQcRow,
  judgeQc,
  refillResult,
  retainRowsWithQc,
  reviewQc,
  submitQc,
} from '@/api/finishedqc-service'
import { registerMigrators, storageKey, listRows } from '@/data/local-store'
import { migrateV1ToV2 } from '@/data/migrations'
import { SEED_ROWS } from '@/data/seed'
import { inspectionItemNames } from '@/domain/inspection-items'

registerMigrators([migrateV1ToV2])

// ---- 内存 localStorage 桩 ----
const memory = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
}

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

// ========== 1. 判定引擎：同源 + 零值不放行 + 负数非法 ==========
console.log('判定引擎')
check('标准>=95、实测98.6 → 合格', (evaluateConclusion('>=95', '98.6') as any).verdict === '合格')
const zero = evaluateConclusion('>=95', '0')
check('标准>=95、实测0 → 不合格（零值不放行）', zero.ok && zero.verdict === '不合格', JSON.stringify(zero))
const negative = evaluateConclusion('5.0~7.0', '-1')
check('实测负数 → RESULT_INVALID', !negative.ok && negative.code === 'RESULT_INVALID')
check('空标准 → SPEC_MISSING', !evaluateConclusion('', '99').ok && (evaluateConclusion('', '99') as any).code === 'SPEC_MISSING')
check('空结果 → RESULT_MISSING', !(evaluateConclusion('>=95', '') as any).ok && (evaluateConclusion('>=95', '') as any).code === 'RESULT_MISSING')
check('区间内 → 合格', evaluateConclusion('5.0~7.0', '6.2').ok === true && (evaluateConclusion('5.0~7.0', '6.2') as any).verdict === '合格')
check('超上限 → 不合格', (evaluateConclusion('<=1.0', '1.6') as any).verdict === '不合格')
check('定性合格', (evaluateConclusion('符合规定', '符合规定') as any).verdict === '合格')
check('定性不合格', (evaluateConclusion('符合规定', '不符合规定') as any).verdict === '不合格')
check('全角 >= 解析', (evaluateConclusion('≥95', '96') as any).verdict === '合格')
check('乱填文本 → RESULT_INVALID', (evaluateConclusion('>=95', 'abc') as any).code === 'RESULT_INVALID')
check('数值结果配定性标准 → TYPE_MISMATCH', (evaluateConclusion('符合规定', '90') as any).code === 'TYPE_MISMATCH')
check('无法识别的标准 → SPEC_UNRECOGNIZED', (evaluateConclusion('约等于95', '95') as any).code === 'SPEC_UNRECOGNIZED')

// ========== 2. 种子数据直接走服务（首次播种） ==========
console.log('种子数据场景')
// id2：标准>=95、结果0、检验中 → 判定必须是不合格
const r2 = judgeQc(2)
check('零值记录判定返回不合格并落库', r2.ok && getQcRow(2)!.status === '不合格' && getQcRow(2)!.判定结论 === '不合格', r2.message)
// id5：标准为空 → 判定拦截
const r5 = judgeQc(5)
check('缺标准记录被拦截', !r5.ok && detectIssue(getQcRow(5)!).code === 'SPEC_MISSING', r5.message)
// 复检也被锁死
const rc5 = createRecheck(5, '99', '复核员')
check('缺标准时复检一并锁死', !rc5.ok && /锁死|补齐/.test(rc5.message), rc5.message)
// id6：负数结果 → 重填
const r6judge = judgeQc(6)
check('负数结果不能判定', !r6judge.ok && detectIssue(getQcRow(6)!).code === 'RESULT_INVALID')
const r6refill = refillResult(6, '5.8', '刘洋')
check('负数结果重填为合法值后回到检验中', r6refill.ok && getQcRow(6)!.检验结果 === '5.8' && getQcRow(6)!.status === '检验中', r6refill.message)
const r6again = judgeQc(6)
check('重填后判定合格', r6again.ok && getQcRow(6)!.判定结论 === '合格')
check('非法值重填负数仍被拒', !refillResult(6, '-3', '刘洋').ok)
// id4：待检验无结果 → 提交后判不了
check('待检验直接判定被状态机挡住', !judgeQc(4).ok)
check('提交检验后结果缺失仍拦截', submitQc(4).ok && !judgeQc(4).ok)
// id7：检验中合法值 86.2 → 合格
check('id7 判定合格', judgeQc(7).ok && getQcRow(7)!.status === '已合格')

// ========== 3. 状态一段一段走、倒序拒收 ==========
console.log('状态机')
const created = createQcReport({ 检验编号: 'FINI-0901', 产品批号: 'PI-NEW1', 检验项目: '含量测定', 标准规定: '', 检验人: '甲' })
check('登记报告成功且带出自带标准', created.ok && getQcRow(created.id!)!.标准规定 === '>=95')
check('待检验不能直接判定（跳步拒收）', !judgeQc(created.id!).ok)
check('提交检验成功', submitQc(created.id!).ok)
check('倒序回到待检验被拒收', !submitQc(created.id!).ok)
// 给新报告填结果
refillResult(created.id!, '99', '甲')
check('判定合格', judgeQc(created.id!).ok && getQcRow(created.id!)!.status === '已合格')
check('已合格重复判定拒收', !judgeQc(created.id!).ok)
check('目录外项目不能登记', !createQcReport({ 检验编号: 'FINI-0902', 产品批号: 'X', 检验项目: '自编项目', 标准规定: '', 检验人: '甲' }).ok)
check('重复编号不能登记', !createQcReport({ 检验编号: 'FINI-0901', 产品批号: 'Y', 检验项目: '性状', 标准规定: '', 检验人: '甲' }).ok)

// ========== 4. 复核幂等 ==========
console.log('复核')
check('首次复核成功', reviewQc(7, '李建国').ok)
check('重复复核只算一次', !reviewQc(7, '王复核').ok)
check('未判定不能复核', !reviewQc(5, '李建国').ok)

// ========== 5. 复检 ==========
console.log('复检')
// id3 已不合格：复检一轮合格
const re1 = createRecheck(3, '0.8', '复检员')
check('复检合法值合格并更新主判定', re1.ok && getQcRow(3)!.判定结论 === '合格' && getQcRow(3)!.复检记录.length === 1, re1.message)
const re1dup = createRecheck(3, '0.8', '复检员')
check('同轮同人同结果重复复检只算一次', !re1dup.ok)
const reNeg = createRecheck(3, '-1', '复检员')
check('复检负数被拒', !reNeg.ok)
const zeroLow = createRecheck(2, '0', '复检员') // id2 标准>=95，结果0
check('复检零值低于下限判不合格', zeroLow.ok && getQcRow(2)!.判定结论 === '不合格', zeroLow.message)

// ========== 6. 批量判定：断点续跑 + 幂等 ==========
console.log('批量判定')
clearBatchCheckpoint()
// 当前检验中且可判：补齐 id5 标准后才有可判项；先验证空态
const emptyBatch = batchEvaluate()
// 此时检验中：id4（缺结果，RESULT_MISSING）、id5（缺标准）。无可判定项。
check('无可判定记录给空态说明', emptyBatch.empty && /没有可判定|补齐/.test(emptyBatch.message), emptyBatch.message)
// 补齐 id5
check('补齐标准成功', fillSpec(5, '<=3.0').ok)
// 此时可判定：id5（2.1 合格）。id4 仍缺结果被拦。
const b1 = batchEvaluate()
check('批量判定处理可判项并列出拦截', b1.processed === 1 && b1.passed === 1 && b1.blocked === 1, JSON.stringify({ p: b1.processed, b: b1.blocked }))
check('被拦截项包含 id4', b1.blockedRows.some((x) => x.id === 4))
// 再跑一次：没有可判项，且不会重复判定
const b2 = batchEvaluate()
check('重试不重复处理已判定记录', b2.empty && !/合格 1/.test(b2.message))

// ========== 7. 留样联动 ==========
console.log('留样联动')
const retains = retainRowsWithQc()
const link1 = retains.find((r) => r.对应批号 === 'PI-260901')
check('留样清单带出合格结论', link1?.检验结论 === '合格' && link1?.检验编号 === 'FINI-0001')
const link3 = retains.find((r) => r.对应批号 === 'PI-260903')
check('留样反映复检后的合格结论（id3 批号 PI-260903）', link3?.检验结论 === '合格')
check('不合格批号留样打异常标', retains.find((r) => r.对应批号 === 'PI-260902')?.abnormal === true)

// ========== 8. 列表/详情同源 ==========
console.log('同源读取')
check('详情读取口与列表底层是同一对象', getQcRow(1) === listRows('finishedqc').find((r) => Number(r.id) === 1))

// ========== 9. 存量迁移：按旧记录回填 ==========
console.log('存量迁移')
memory.clear()
// 构造 v1 脏数据：结果0却已合格（错误放行）、缺标准却已合格、负数已合格
const legacy: Record<string, any[]> = {
  finishedqc: [
    { id: 1, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-1', 产品批号: 'B1', 检验项目: '含量测定', 标准规定: '>=95', 检验结果: '0', 判定结论: '合格', 检验人: '旧' },
    { id: 2, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-2', 产品批号: 'B2', 检验项目: '水分', 标准规定: '', 检验结果: '', 判定结论: '合格', 检验人: '旧' },
    { id: 3, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-3', 产品批号: 'B3', 检验项目: 'pH值', 标准规定: '5.0~7.0', 检验结果: '-1', 判定结论: '合格', 检验人: '旧' },
    { id: 4, status: '已合格', pending: false, abnormal: false, 检验编号: 'OLD-4', 产品批号: 'B4', 检验项目: '有关物质', 标准规定: '<=1.0', 检验结果: '0.5', 判定结论: '合格', 检验人: '旧' },
  ],
  retainsample: [
    { id: 1, status: '已留样', pending: false, abnormal: false, 留样编号: 'RT-1', 对应批号: 'B4' },
  ],
}
memory.set(storageKey(), JSON.stringify(legacy))
// 对迁移函数直接做往返校验（读盘迁移由 local-store 版本链保证）。
const migrated = JSON.parse(JSON.stringify(legacy))
migrateV1ToV2(migrated)
const m1 = migrated.finishedqc.find((r: any) => r.id === 1)
check('迁移：零值错误放行被撤回重判为不合格', m1.status === '不合格' && m1.判定结论 === '不合格', JSON.stringify({ s: m1.status, v: m1.判定结论 }))
const m2 = migrated.finishedqc.find((r: any) => r.id === 2)
check('迁移：缺标准的假合格撤回检验中并标异常', m2.status === '检验中' && m2.abnormal === true)
const m3 = migrated.finishedqc.find((r: any) => r.id === 3)
check('迁移：负数假合格撤回检验中', m3.status === '检验中' && /非法/.test(m3.判定说明))
const m4 = migrated.finishedqc.find((r: any) => r.id === 4)
check('迁移：自洽合格记录只补判定说明不改结论', m4.status === '已合格' && m4.判定结论 === '合格' && m4.判定说明.length > 0)
const rt = migrated.retainsample.find((r: any) => r.id === 1)
check('迁移：留样按旧批号回填检验结论与编号', rt.检验结论 === '合格' && rt.检验编号 === 'OLD-4')
// 迁移幂等：再跑一遍结果不变
const before = JSON.stringify(migrated.finishedqc[3])
migrateV1ToV2(migrated)
check('迁移幂等：自洽记录二次迁移不变', JSON.stringify(migrated.finishedqc.find((r: any) => r.id === 4)) === before)

// ========== 10. 统一项目目录 ==========
console.log('项目目录')
check('目录包含核心检验项目', ['性状', '鉴别', '含量测定', '有关物质', '水分'].every((n) => inspectionItemNames().includes(n)))
check('种子成品检验项目全部在目录内', SEED_ROWS.finishedqc.every((r) => inspectionItemNames().includes(String(r.检验项目))))
check('种子稳定性检验项目也在同一目录', SEED_ROWS.stability.every((r) => inspectionItemNames().includes(String(r.检验项目))))

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
