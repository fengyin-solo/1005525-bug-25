import { evaluateConclusion } from '@/domain/evaluate'
import type { EntryRow } from './types'

/**
 * 存量数据迁移 v1 -> v2：
 * 1. 给老的成品检验记录补齐新结构（判定说明、复核人、复核日期、复检记录）；
 * 2. 按旧记录回填判定——标准规定为空、结果为负数/零值却被放行的，一律撤回重判；
 * 3. 已有结论的老记录用判定引擎重算判定说明，保证结果、标准、结论同源；
 * 4. 留样清单回填与成品批号的联动字段。
 * 迁移幂等：已经是新结构且结论自洽的记录不会被反复改动。
 */
export function migrateV1ToV2(data: Record<string, EntryRow[]>): void {
  const qcRows = data.finishedqc
  if (Array.isArray(qcRows)) {
    data.finishedqc = qcRows.map((row) => migrateQcRow(row))
  }
  const retainRows = data.retainsample
  if (Array.isArray(retainRows)) {
    data.retainsample = migrateRetainRows(retainRows, data.finishedqc ?? [])
  }
}

function migrateQcRow(row: EntryRow): EntryRow {
  const next: EntryRow = {
    ...row,
    判定说明: String(row.判定说明 ?? ''),
    复核人: String(row.复核人 ?? ''),
    复核日期: String(row.复核日期 ?? ''),
    复检记录: Array.isArray(row.复检记录) ? row.复检记录 : [],
  }

  const spec = String(next.标准规定 ?? '')
  const result = String(next.检验结果 ?? '')
  const outcome = evaluateConclusion(spec, result)
  const judged = next.status === '已合格' || next.status === '不合格'

  if (!outcome.ok) {
    // 老数据里的脏记录：缺标准、负数、零值配高限标准等——撤回判定，回到检验中等待处理。
    if (judged || String(next.判定结论) !== '') {
      next.判定结论 = ''
      next.判定说明 = outcome.message
      next.status = '检验中'
      next.pending = true
      next.abnormal = true
    } else if (outcome.code !== 'RESULT_MISSING') {
      next.abnormal = true
      if (!next.判定说明) next.判定说明 = outcome.message
    }
    return next
  }

  // 结论与状态对得上的老记录：只回填判定说明，不动历史结论。
  if (String(next.判定结论) === outcome.verdict) {
    if (!next.判定说明) next.判定说明 = outcome.reason
    next.abnormal = next.判定结论 === '不合格'
    return next
  }

  // 状态说合格但结论对不上（典型：结果填 0 却放行）：以判定引擎为准回填。
  next.判定结论 = outcome.verdict
  next.判定说明 = outcome.reason
  next.status = outcome.verdict === '合格' ? '已合格' : '不合格'
  next.pending = false
  next.abnormal = outcome.verdict === '不合格'
  return next
}

function migrateRetainRows(retainRows: EntryRow[], qcRows: EntryRow[]): EntryRow[] {
  const latestByBatch = new Map<string, EntryRow>()
  for (const row of qcRows) {
    const verdict = String(row.判定结论 ?? '')
    if (verdict === '合格' || verdict === '不合格') {
      latestByBatch.set(String(row.产品批号 ?? ''), row)
    }
  }
  return retainRows.map((row) => {
    const qc = latestByBatch.get(String(row.对应批号 ?? ''))
    if (!qc) {
      return {
        ...row,
        检验结论: String(row.检验结论 ?? ''),
        检验编号: String(row.检验编号 ?? ''),
      }
    }
    return {
      ...row,
      检验结论: String(qc.判定结论),
      检验编号: String(qc.检验编号),
      abnormal: row.abnormal || qc.判定结论 === '不合格',
    }
  })
}
