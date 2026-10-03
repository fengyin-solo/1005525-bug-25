import { evaluateConclusion, normalizeResult } from '@/domain/evaluate'
import { defaultSpecOf, inspectionItemNames, isKnownItem } from '@/domain/inspection-items'
import { listRows, saveMany, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BatchEvaluateResult,
  EntryRow,
  QcIssueCode,
  RecheckRecord,
} from '@/data/types'

const QC_KEY = 'finishedqc'
const RETAIN_KEY = 'retainsample'
const CHECKPOINT_KEY = 'pharma-cleanroom:qc-batch-checkpoint'
const STATUSES = ['待检验', '检验中', '已合格', '不合格']
const FINAL_STATUSES = ['已合格', '不合格']

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/** 列表与详情面板唯一的数据读取口：两边都从这份内存数据按 id 取，不走任何缓存副本。 */
export function getQcRow(id: number): EntryRow | undefined {
  return listRows(QC_KEY).find((row) => Number(row.id) === id)
}

export type QcIssue = { code: QcIssueCode; message: string }

/** 判定前检查：标准规定缺失单独拦下，负数等非法值要求重填。返回 null 表示可判定。 */
export function detectIssue(row: EntryRow): QcIssue {
  if (text(row, '标准规定') === '') {
    return { code: 'SPEC_MISSING', message: '标准规定为空，请先补齐标准规定再判定' }
  }
  const result = text(row, '检验结果')
  if (result === '') {
    return { code: 'RESULT_MISSING', message: '检验结果尚未登记，请先录入实测结果' }
  }
  const outcome = evaluateConclusion(String(row.标准规定 ?? ''), result)
  if (!outcome.ok) {
    return { code: outcome.code, message: outcome.message }
  }
  return { code: null, message: '' }
}

/** 状态只能沿 待检验→检验中→已合格/不合格 往前走，倒序、跳步、重复落判一律拒收。 */
function ensureForward(row: EntryRow, target: string): ActionResult | null {
  const from = text(row, 'status')
  if (from === target) {
    return { ok: false, message: `报告已是「${target}」，该操作只计算一次，请勿重复操作` }
  }
  const fromIndex = STATUSES.indexOf(from)
  const targetIndex = STATUSES.indexOf(target)
  if (targetIndex < 0 || fromIndex < 0) {
    return { ok: false, message: `未知的状态流转：${from} → ${target}` }
  }
  if (targetIndex < fromIndex) {
    return { ok: false, message: `状态只能逐段向前流转，不能从「${from}」倒序回到「${target}」` }
  }
  if (targetIndex !== fromIndex + 1 && !(fromIndex === 1 && FINAL_STATUSES.includes(target))) {
    return { ok: false, message: `状态必须一段一段往下走，不能从「${from}」直接跳到「${target}」` }
  }
  return null
}

/** 提交检验：待检验 → 检验中。 */
export function submitQc(id: number): ActionResult {
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  const guard = ensureForward(rows[index], '检验中')
  if (guard) return guard
  rows[index] = { ...rows[index], status: '检验中', pending: true }
  saveRows(QC_KEY, rows)
  return { ok: true, message: `报告 ${text(rows[index], '检验编号')} 已提交检验，进入检验中` }
}

function applyVerdict(row: EntryRow): { row: EntryRow; verdict: '合格' | '不合格'; reason: string } {
  const outcome = evaluateConclusion(String(row.标准规定 ?? ''), String(row.检验结果 ?? ''))
  // 调用方已通过 detectIssue 闸门，这里一定是可判定的。
  const verdict = outcome.ok ? outcome.verdict : '不合格'
  const reason = outcome.ok ? outcome.reason : outcome.message
  return {
    row: {
      ...row,
      判定结论: verdict,
      判定说明: reason,
      status: verdict === '合格' ? '已合格' : '不合格',
      pending: false,
      abnormal: verdict === '不合格',
    },
    verdict,
    reason,
  }
}

/**
 * 单条判定：检验结果、标准规定、判定结论同源——结论只能由判定引擎比对产生，
 * 页面不再允许手工把结论写成合格；实测零值低于下限时按不合格处理，绝不放行。
 */
export function judgeQc(id: number): ActionResult {
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  const row = rows[index]
  if (FINAL_STATUSES.includes(text(row, 'status'))) {
    return { ok: false, message: `报告 ${text(row, '检验编号')} 已判定为「${text(row, 'status')}」，重复判定不再执行；如需更正请发起复检或重填` }
  }
  const issue = detectIssue(row)
  if (issue.code) {
    return { ok: false, message: `报告 ${text(row, '检验编号')}：${issue.message}` }
  }
  const guard = ensureForward(row, applyVerdict(row).verdict === '合格' ? '已合格' : '不合格')
  if (guard) return guard
  const { row: judged, verdict, reason } = applyVerdict(row)
  rows[index] = judged
  const { retain: nextRetain } = syncRetain(rows)
  saveMany({ [QC_KEY]: rows, [RETAIN_KEY]: nextRetain })
  return { ok: true, message: `报告 ${text(judged, '检验编号')} 判定${verdict}：${reason}` }
}

/** 标准规定缺失的记录单独补齐；标准规定写不出比较规则的也在这里修正。 */
export function fillSpec(id: number, spec: string): ActionResult {
  const value = spec.trim()
  if (value === '') {
    return { ok: false, message: '标准规定不能为空，请填写可判定的标准（如 >=95、<=1.0、5.0~7.0 或“符合规定”）' }
  }
  const probe = evaluateConclusion(value, '符合规定')
  if (!probe.ok && probe.code !== 'TYPE_MISMATCH') {
    const probeNumeric = evaluateConclusion(value, '0')
    if (!probeNumeric.ok && probeNumeric.code !== 'TYPE_MISMATCH') {
      return { ok: false, message: `标准规定「${value}」缺少可判定规则，请使用 ≥、≤、区间或“符合规定”等格式` }
    }
  }
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  rows[index] = { ...rows[index], 标准规定: value, abnormal: false, 判定说明: '' }
  saveRows(QC_KEY, rows)
  return { ok: true, message: `报告 ${text(rows[index], '检验编号')} 的标准规定已补齐：${value}` }
}

/** 检验结果填成负数等非法值时的重填入口：先校验再落库，写库值与明细始终一致。 */
export function refillResult(id: number, rawResult: string, inspector: string): ActionResult {
  const normalized = normalizeResult(rawResult)
  if ('error' in normalized) {
    return { ok: false, message: normalized.error }
  }
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  const row = rows[index]
  const status = text(row, 'status')
  if (status === '待检验') {
    return { ok: false, message: '报告尚未提交检验，请先执行「提交检验」' }
  }
  rows[index] = {
    ...row,
    检验结果: normalized.value,
    检验人: inspector.trim() || text(row, '检验人'),
    判定结论: '',
    判定说明: '',
    status: '检验中',
    pending: true,
    abnormal: false,
    复核人: '',
    复核日期: '',
    复检记录: [],
  }
  const { retain: nextRetain } = syncRetain(rows)
  saveMany({ [QC_KEY]: rows, [RETAIN_KEY]: nextRetain })
  return { ok: true, message: `报告 ${text(rows[index], '检验编号')} 的检验结果已重填为 ${normalized.value}，请重新判定` }
}

/**
 * 同一份报告重复复核只算一次：已记录复核人即拒绝重复提交。
 * 复核幂等键是报告 id——无论点几次按钮，只产生一次复核结果。
 */
export function reviewQc(id: number, reviewer: string): ActionResult {
  const name = reviewer.trim()
  if (name === '') return { ok: false, message: '请填写复核人' }
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  const row = rows[index]
  if (!FINAL_STATUSES.includes(text(row, 'status'))) {
    return { ok: false, message: `报告 ${text(row, '检验编号')} 尚未判定，不能复核` }
  }
  if (text(row, '复核人') !== '') {
    return { ok: false, message: `报告 ${text(row, '检验编号')} 已由 ${text(row, '复核人')} 复核过，同一份报告重复复核只算一次` }
  }
  rows[index] = { ...row, 复核人: name, 复核日期: today() }
  const { retain: nextRetain } = syncRetain(rows)
  saveMany({ [QC_KEY]: rows, [RETAIN_KEY]: nextRetain })
  return { ok: true, message: `报告 ${text(rows[index], '检验编号')} 复核完成（复核人：${name}）` }
}

/**
 * 登记复检：主报告标准规定为空时，连复检报告一起锁死；
 * 复检结果必须是合法值，复检结论同样由判定引擎产出（零值不天然放行）。
 * 每次复检追加一条复检记录，并以最新复检结论更新主判定。
 */
export function createRecheck(id: number, rawResult: string, reviewer: string): ActionResult {
  const normalized = normalizeResult(rawResult)
  if ('error' in normalized) {
    return { ok: false, message: `复检结果非法：${normalized.error}` }
  }
  if (reviewer.trim() === '') return { ok: false, message: '请填写复检人' }
  const rows = listRows(QC_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  const row = rows[index]
  if (text(row, '标准规定') === '') {
    return { ok: false, message: `报告 ${text(row, '检验编号')} 的标准规定为空，复检报告一并锁死，请先补齐标准规定` }
  }
  const status = text(row, 'status')
  if (status !== '检验中' && !FINAL_STATUSES.includes(status)) {
    return { ok: false, message: `报告当前为「${status}」，还不能登记复检` }
  }
  const outcome = evaluateConclusion(String(row.标准规定 ?? ''), normalized.value)
  if (!outcome.ok) {
    return { ok: false, message: outcome.message }
  }
  const history = (Array.isArray(row.复检记录) ? row.复检记录 : []) as RecheckRecord[]
  // 同轮、同人、同结果的重复复检提交只算一次。
  const last = history[history.length - 1]
  if (last && last.result === normalized.value && last.reviewer === reviewer.trim()) {
    return { ok: false, message: `报告 ${text(row, '检验编号')} 第 ${last.round} 轮复检已登记，重复提交只算一次` }
  }
  const record: RecheckRecord = {
    id: `RC-${row.id}-${history.length + 1}`,
    round: history.length + 1,
    result: normalized.value,
    verdict: outcome.verdict,
    reason: outcome.reason,
    reviewer: reviewer.trim(),
    reviewedAt: today(),
  }
  rows[index] = {
    ...row,
    检验结果: normalized.value,
    判定结论: outcome.verdict,
    判定说明: `第 ${record.round} 轮复检：${outcome.reason}`,
    status: outcome.verdict === '合格' ? '已合格' : '不合格',
    pending: false,
    abnormal: outcome.verdict === '不合格',
    复核人: reviewer.trim(),
    复核日期: today(),
    复检记录: [...history, record],
  }
  const { retain: nextRetain } = syncRetain(rows)
  saveMany({ [QC_KEY]: rows, [RETAIN_KEY]: nextRetain })
  return { ok: true, message: `报告 ${text(rows[index], '检验编号')} 第 ${record.round} 轮复检判定${outcome.verdict}` }
}

/** 登记新报告：检验项目只能选自统一目录，标准规定随项目带出，可在此基础上核对修改。 */
export function createQcReport(input: {
  检验编号: string
  产品批号: string
  检验项目: string
  标准规定: string
  检验人: string
}): ActionResult & { id?: number } {
  const no = input.检验编号.trim()
  const batch = input.产品批号.trim()
  const item = input.检验项目.trim()
  const inspector = input.检验人.trim()
  if (!no || !batch || !item || !inspector) {
    return { ok: false, message: '检验编号、产品批号、检验项目、检验人都不能为空' }
  }
  if (!isKnownItem(item)) {
    return { ok: false, message: `检验项目「${item}」不在统一检验项目目录内，请从目录中选择：${inspectionItemNames().join('、')}` }
  }
  const spec = input.标准规定.trim() || defaultSpecOf(item)
  const rows = listRows(QC_KEY)
  if (rows.some((row) => text(row, '检验编号') === no)) {
    return { ok: false, message: `检验编号 ${no} 已存在，不能重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: no,
    产品批号: batch,
    检验项目: item,
    标准规定: spec,
    检验结果: '',
    判定结论: '',
    判定说明: '',
    检验人: inspector,
    复核人: '',
    复核日期: '',
    复检记录: [],
  }
  saveRows(QC_KEY, [...rows, row])
  return { ok: true, message: `报告 ${no} 已登记，标准规定按目录带出：${spec}`, id }
}

// ---------- 批量判定（断点续跑） ----------

type Checkpoint = {
  candidateIds: number[]
  cursor: number
  startedAt: string
}

function readCheckpoint(): Checkpoint | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(CHECKPOINT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Checkpoint
  } catch {
    return null
  }
}

function writeCheckpoint(point: Checkpoint | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (point === null) {
    window.localStorage.removeItem(CHECKPOINT_KEY)
  } else {
    window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(point))
  }
}

export function batchCheckpointInfo(): { running: boolean; done: number; total: number } {
  const point = readCheckpoint()
  if (!point) return { running: false, done: 0, total: 0 }
  return { running: true, done: point.cursor, total: point.candidateIds.length }
}

function isJudgable(row: EntryRow): boolean {
  const status = text(row, 'status')
  if (FINAL_STATUSES.includes(status)) return false
  if (status !== '检验中') return false
  return detectIssue(row).code === null
}

function isBlocked(row: EntryRow): boolean {
  if (text(row, 'status') !== '检验中') return false
  return detectIssue(row).code !== null
}

function emptyMessage(rows: EntryRow[]): string {
  const pending = rows.filter((row) => !FINAL_STATUSES.includes(text(row, 'status'))).length
  const blocked = rows.filter(isBlocked).length
  if (rows.length === 0) return '当前没有成品检验记录，请先登记报告'
  if (pending === 0) return '所有在检报告均已判定，没有可判定的记录'
  return `没有可直接判定的记录：在检 ${pending} 条，其中 ${blocked} 条被拦截（标准规定缺失或结果非法），请先补齐、重填后再批量判定`
}

/**
 * 批量判定：
 * - 只挑检验中且可判定的记录，判定动作与单条判定完全同一套引擎；
 * - 每处理一条就落库并推进断点；失败重试时从未处理位置续跑，不重复处理已判定项；
 * - 遇到被拦截的记录不中断整批：先处理可判定项，被拦截项在结果里列出来提示补齐。
 */
export function batchEvaluate(): BatchEvaluateResult {
  const rows = listRows(QC_KEY)
  let point = readCheckpoint()
  if (!point) {
    const candidates = rows.filter((row) => text(row, 'status') === '检验中')
    const candidateIds = candidates.map((row) => Number(row.id))
    if (!candidates.some((candidate) => isJudgable(candidate))) {
      return {
        processed: 0,
        passed: 0,
        failed: 0,
        blocked: candidates.filter((row) => isBlocked(row)).length,
        skipped: 0,
        total: candidates.length,
        remaining: 0,
        blockedRows: [],
        empty: true,
        message: emptyMessage(rows),
      }
    }
    point = { candidateIds, cursor: 0, startedAt: today() }
  }

  const latestRows = listRows(QC_KEY)
  let passed = 0
  let failed = 0
  const blockedRows: BatchEvaluateResult['blockedRows'] = []
  let processed = 0

  for (let i = point.cursor; i < point.candidateIds.length; i += 1) {
    const rowIndex = latestRows.findIndex((row) => Number(row.id) === point!.candidateIds[i])
    if (rowIndex < 0) {
      point.cursor = i + 1
      continue
    }
    const row = latestRows[rowIndex]
    // 上一轮已经判过（重试场景）：跳过且不计重复。
    if (FINAL_STATUSES.includes(text(row, 'status'))) {
      point.cursor = i + 1
      continue
    }
    if (text(row, 'status') !== '检验中') {
      point.cursor = i + 1
      continue
    }
    const issue = detectIssue(row)
    if (issue.code) {
      blockedRows.push({
        id: Number(row.id),
        检验编号: text(row, '检验编号'),
        检验项目: text(row, '检验项目'),
        message: issue.message,
      })
      point.cursor = i + 1
      continue
    }
    const { row: judged, verdict } = applyVerdict(row)
    latestRows[rowIndex] = judged
    processed += 1
    if (verdict === '合格') passed += 1
    else failed += 1
    // 每条处理完立即落库 + 推进断点：中途失败下次从这里续跑。
    point.cursor = i + 1
    const { retain: nextRetain } = syncRetain(latestRows)
    saveMany({ [QC_KEY]: latestRows, [RETAIN_KEY]: nextRetain })
    writeCheckpoint({ ...point })
  }

  const done = point.cursor >= point.candidateIds.length
  if (done) {
    writeCheckpoint(null)
  }
  const remaining = point.candidateIds.length - point.cursor
  return {
    processed,
    passed,
    failed,
    blocked: blockedRows.length,
    skipped: 0,
    total: point.candidateIds.length,
    remaining,
    blockedRows,
    empty: false,
    message: done
      ? `批量判定完成：本次处理 ${processed} 条（合格 ${passed} / 不合格 ${failed}），拦截 ${blockedRows.length} 条待补齐`
      : `处理到第 ${point.cursor}/${point.candidateIds.length} 条中断，已从断点保存，可重试续跑`,
  }
}

/** 放弃当前批量断点（记录已落库的判定不回滚，只是清掉续跑位置）。 */
export function clearBatchCheckpoint(): void {
  writeCheckpoint(null)
}

// ---------- 留样联动 ----------

/**
 * 成品检验结论同步到留样管理清单：
 * 只更新留样里已登记的同批号记录（检验结论、检验编号、异常标记），
 * 不在留样模块凭空造记录；两边始终从同一次落库里读出。
 */
export function syncRetain(qcRows: EntryRow[]): { retain: EntryRow[]; changed: boolean } {
  const retain = listRows(RETAIN_KEY)
  const latestByBatch = new Map<string, EntryRow>()
  for (const row of qcRows) {
    const verdict = text(row, '判定结论')
    if (verdict === '合格' || verdict === '不合格') {
      latestByBatch.set(text(row, '产品批号'), row)
    }
  }
  let changed = false
  const next = retain.map((row) => {
    const qc = latestByBatch.get(text(row, '对应批号'))
    const verdict = qc ? text(qc, '判定结论') : ''
    if (!qc) {
      const cleared = row.检验结论 !== undefined || row.检验编号 !== undefined
      if (cleared && text(row, '检验结论') !== '') {
        changed = true
        return { ...row, 检验结论: '', 检验编号: '', abnormal: false }
      }
      return row
    }
    if (text(row, '检验结论') === verdict && text(row, '检验编号') === text(qc, '检验编号')) {
      return row
    }
    changed = true
    return {
      ...row,
      检验结论: verdict,
      检验编号: text(qc, '检验编号'),
      abnormal: verdict === '不合格',
    }
  })
  return { retain: next, changed }
}

/** 留样页读取清单时调用：以成品检验最新结论校正展示。 */
export function retainRowsWithQc(): EntryRow[] {
  const qcRows = listRows(QC_KEY)
  const { retain, changed } = syncRetain(qcRows)
  if (changed) {
    saveRows(RETAIN_KEY, retain)
  }
  return retain
}
