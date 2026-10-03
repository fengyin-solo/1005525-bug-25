/**
 * 成品检验领域服务：页面不做业务判断，检验结果/标准规定/判定结论在这里同源处理。
 * - 判定结论一律由 qc-engine 按「标准规定 + 检验结果」推导，写库与明细用同一份行数据；
 * - 状态一段一段往下走，倒序、跳段的请求直接拒收；
 * - 同一份报告的重复复核只计一次（复核计数）；
 * - 判定结果同步 upsert 到留样管理清单；
 * - 批量判定失败时保留断点，重试从断点续跑。
 */
import { evaluateQc, issueMessage } from '@/api/qc-engine'
import {
  clearQcCheckpoint,
  listRows,
  nextId,
  readQcCheckpoint,
  saveRows,
  writeQcCheckpoint,
} from '@/data/local-store'
import type { ActionResult, BatchJudgeItem, BatchJudgeReport, EntryRow } from '@/data/types'

export const QC_KEY = 'finishedqc'
const RETAIN_KEY = 'retainsample'

const STATUSES = ['待检验', '检验中', '已合格', '不合格']
const RESULT_FIELDS = ['检验编号', '产品批号', '检验项目', '标准规定', '检验结果', '判定结论', '检验人', '复核次数', '检验状态']

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function load(): EntryRow[] {
  return listRows(QC_KEY)
}

function persist(rows: EntryRow[]): void {
  saveRows(QC_KEY, rows)
}

function findIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

/** 判定引擎体检：列表、详情、批量、表单复用同一份结论。 */
export function checkRow(row: EntryRow) {
  return evaluateQc(row.标准规定, row.检验结果)
}

function rowBlockMessage(row: EntryRow): string {
  const check = evaluateQc(row.标准规定, row.检验结果)
  if (check.ok) {
    return ''
  }
  return issueMessage(check.issue, text(row.检验编号))
}

/** 需要补齐/重填的记录（标准规定缺失、结果为空/零值/负值/非数值）。 */
export function blockedRows(rows: EntryRow[] = load()): EntryRow[] {
  return rows.filter((row) => !evaluateQc(row.标准规定, row.检验结果).ok)
}

export function listQcRows(): EntryRow[] {
  return load()
}

export function getQcRow(id: number): EntryRow | null {
  return load().find((row) => Number(row.id) === id) ?? null
}

export type QcDraft = {
  产品批号: string
  检验项目: string
  标准规定: string
  检验结果: string
  检验人: string
}

/** 登记/重填前的字段校验：标准必填；待检验可空结果，检验中的零、负、非数值一律打回重填。 */
export function validateQcDraft(draft: QcDraft, status: string): ActionResult {
  if (!text(draft.产品批号)) {
    return { ok: false, message: '产品批号不能为空' }
  }
  if (!text(draft.检验项目)) {
    return { ok: false, message: '请选择检验项目' }
  }
  if (!text(draft.标准规定)) {
    return { ok: false, message: '标准规定不能为空，请补齐标准规定' }
  }
  if (!text(draft.检验人)) {
    return { ok: false, message: '检验人不能为空' }
  }
  if (status === '检验中' || text(draft.检验结果) !== '') {
    const check = evaluateQc(draft.标准规定, draft.检验结果)
    if (!check.ok) {
      return { ok: false, message: issueMessage(check.issue) }
    }
  }
  return { ok: true, message: '' }
}

function nextQcCode(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const matched = text(row.检验编号).match(/FINI-(\d+)/)
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `FINI-${String(max + 1).padStart(4, '0')}`
}

/** 登记成品检验报告：新报告从「待检验」起步，判定结论保持空白。 */
export function createQcEntry(draft: QcDraft): ActionResult {
  const invalid = validateQcDraft(draft, '待检验')
  if (!invalid.ok) {
    return invalid
  }
  const rows = load()
  const row: EntryRow = {
    id: nextId(QC_KEY),
    status: '待检验',
    pending: true,
    abnormal: false,
    检验编号: nextQcCode(rows),
    产品批号: text(draft.产品批号),
    检验项目: text(draft.检验项目),
    标准规定: text(draft.标准规定),
    检验结果: text(draft.检验结果),
    判定结论: '',
    检验人: text(draft.检验人),
    复核次数: 0,
    检验状态: '待检验',
  }
  persist([...rows, row])
  return { ok: true, message: `成品检验报告 ${row.检验编号} 已登记，当前状态「待检验」` }
}

/**
 * 补齐标准规定 / 重填检验结果。只接受「待检验」「检验中」的记录，
 * 判定后的报告必须走复检，避免改掉已归档结论。
 */
export function saveQcEntry(id: number, draft: QcDraft): ActionResult {
  const rows = load()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  }
  const current = rows[index]
  if (!['待检验', '检验中'].includes(String(current.status))) {
    return { ok: false, message: '已判定的报告不能直接改动，请通过「发起复检」重新取样检验' }
  }
  const invalid = validateQcDraft(draft, String(current.status))
  if (!invalid.ok) {
    return invalid
  }
  const updated: EntryRow = {
    ...current,
    产品批号: text(draft.产品批号),
    检验项目: text(draft.检验项目),
    标准规定: text(draft.标准规定),
    检验结果: text(draft.检验结果),
    检验人: text(draft.检验人),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, message: `成品检验报告 ${text(updated.检验编号)} 已保存，请继续提交与判定` }
}

/** 状态必须按定义顺序一段一段往下走，倒序或跳段一律拒收。 */
function requireForward(current: string, target: string): ActionResult | null {
  const from = STATUSES.indexOf(current)
  const to = STATUSES.indexOf(target)
  if (from < 0 || to < 0) {
    return { ok: false, message: `未知状态：${current} → ${target}` }
  }
  if (to <= from) {
    return { ok: false, message: `状态只能按顺序往下走，不能从「${current}」倒序回到「${target}」` }
  }
  if (to - from > 1) {
    return { ok: false, message: `不能从「${current}」跳段到「${target}」，请先完成中间环节` }
  }
  return null
}

/** 判定结果反映到留样管理：按产品批号 upsert 一条留样清单记录。 */
function syncRetainSample(row: EntryRow, verdict: '合格' | '不合格'): void {
  const samples = listRows(RETAIN_KEY)
  const batchNo = text(row.产品批号)
  const index = samples.findIndex((sample) => text(sample.对应批号) === batchNo)
  let base: EntryRow
  if (index >= 0) {
    base = { ...samples[index] }
  } else {
    const id = nextId(RETAIN_KEY)
    base = {
      id,
      status: '待留样',
      pending: true,
      abnormal: false,
      留样编号: `RETA-${String(id).padStart(4, '0')}`,
      对应批号: batchNo,
      留样数量: 20,
      留样期限: '',
      存放条件: '',
      取样日期: '',
      销毁日期: '',
    }
  }
  base.成品检验编号 = text(row.检验编号)
  base.检验结论 = verdict
  // 合格放行后留样生效；不合格批次留样挂起，不进入正式留样。
  const sampleStatus = verdict === '合格' ? '已留样' : '待留样'
  base.status = sampleStatus
  base.留样状态 = sampleStatus
  base.pending = sampleStatus !== '已留样'
  base.abnormal = verdict !== '合格'
  const next = index >= 0 ? [...samples] : [...samples, base]
  if (index >= 0) {
    next[index] = base
  }
  saveRows(RETAIN_KEY, next)
}

function judge(rows: EntryRow[], index: number): { ok: boolean; message: string; verdict?: '合格' | '不合格' } {
  const row = rows[index]
  const check = evaluateQc(row.标准规定, row.检验结果)
  if (!check.ok) {
    return { ok: false, message: issueMessage(check.issue, text(row.检验编号)) }
  }
  const verdict = check.verdict
  const reviewCount = Number(row.复核次数 ?? 0) || 0
  const updated: EntryRow = {
    ...row,
    status: verdict === '合格' ? '已合格' : '不合格',
    判定结论: verdict,
    检验状态: verdict === '合格' ? '已合格' : '不合格',
    pending: false,
    // 同一份报告重复复核只算一次：只有真正完成判定动作才 +1，重复点击不再累计。
    复核次数: reviewCount + 1,
    abnormal: verdict !== '合格',
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  syncRetainSample(updated, verdict)
  return { ok: true, verdict, message: `成品检验报告 ${text(row.检验编号)} 判定${verdict}，已同步留样清单` }
}

/**
 * 成品检验动作入口。顺序流转：
 * 待检验 --提交检验--> 检验中 --判定合格/不合格--> 已合格/不合格 --发起复检--> 新报告(待检验)。
 */
export function runQcAction(id: number, action: string): ActionResult {
  const rows = load()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的成品检验报告` }
  }
  const row = rows[index]
  const current = String(row.status)

  if (action === '提交检验') {
    const blocked = requireForward(current, '检验中')
    if (blocked) {
      return blocked
    }
    // 提交即开始检验，标准规定缺失在这里单独拦下，提示补齐，不影响复检报告等其他记录。
    if (!text(row.标准规定)) {
      return { ok: false, message: issueMessage('STANDARD_MISSING', text(row.检验编号)) }
    }
    const updated: EntryRow = { ...row, status: '检验中', 检验状态: '检验中', pending: true }
    const next = [...rows]
    next[index] = updated
    persist(next)
    return { ok: true, message: `成品检验报告 ${text(row.检验编号)} 已提交检验，当前状态「检验中」` }
  }

  if (action === '判定合格' || action === '判定不合格') {
    const want = action === '判定合格' ? '已合格' : '不合格'
    const blocked = requireForward(current, want)
    if (blocked) {
      return blocked
    }
    const result = judge(rows, index)
    if (!result.ok) {
      return { ok: false, message: result.message }
    }
    // 手动指定的判定方向必须与标准+实测的同源结论一致，杜绝写库结论与明细对不上。
    if (result.verdict !== (action === '判定合格' ? '合格' : '不合格')) {
      return {
        ok: false,
        message: `检验编号 ${text(row.检验编号)}：按标准规定与实测结果应为「${result.verdict}」，不能判成相反结论`,
      }
    }
    return { ok: true, message: result.message }
  }

  if (action === '发起复检') {
    if (current !== '不合格') {
      return { ok: false, message: '只有「不合格」的报告可以发起复检' }
    }
    const reCode = `${text(row.检验编号)}-R${(Number(row.复检轮次 ?? 0) || 0) + 1}`
    const exists = rows.some((item) => text(item.检验编号) === reCode)
    if (exists) {
      return { ok: false, message: `复检报告 ${reCode} 已存在，同一份报告重复复核只生成一次复检单` }
    }
    const reRow: EntryRow = {
      id: nextId(QC_KEY),
      status: '待检验',
      pending: true,
      abnormal: false,
      检验编号: reCode,
      产品批号: row.产品批号,
      检验项目: row.检验项目,
      标准规定: row.标准规定,
      检验结果: '',
      判定结论: '',
      检验人: row.检验人,
      复核次数: 0,
      复检来源编号: row.检验编号,
      复检轮次: (Number(row.复检轮次 ?? 0) || 0) + 1,
      检验状态: '待检验',
    }
    persist([...rows, reRow])
    return { ok: true, message: `已为报告 ${text(row.检验编号)} 发起复检，复检报告 ${reCode} 从「待检验」重新流转` }
  }

  return { ok: false, message: `成品检验报告没有登记「${action}」这个动作` }
}

/**
 * 批量判定全部「检验中」记录。遇到标准缺失/零值负值等非法记录时在该处停住，
 * 已处理的逐条落库、未处理的 id 记为断点；补齐后重试即从断点续跑。
 */
export function batchJudgeQc(): BatchJudgeReport {
  const rows = load()
  const checkpoint = readQcCheckpoint()
  const targets = checkpoint.length
    ? rows.filter((row) => checkpoint.includes(Number(row.id)))
    : rows.filter((row) => String(row.status) === '检验中')
  const queue = targets
    .filter((row) => String(row.status) === '检验中')
    .sort((a, b) => Number(a.id) - Number(b.id))

  const items: BatchJudgeItem[] = []
  let passed = 0
  let rejected = 0
  let blockedCount = 0

  for (const row of queue) {
    const currentRows = load()
    const index = findIndex(currentRows, Number(row.id))
    if (index < 0) {
      items.push({ id: Number(row.id), 检验编号: text(row.检验编号), ok: false, message: '记录已不存在', skipped: true })
      continue
    }
    if (String(currentRows[index].status) !== '检验中') {
      items.push({
        id: Number(row.id),
        检验编号: text(currentRows[index].检验编号),
        ok: false,
        message: `当前状态为「${currentRows[index].status}」，本轮跳过`,
        skipped: true,
      })
      continue
    }
    const result = judge(currentRows, index)
    if (!result.ok) {
      // 倒序拒收后从这里断开：后面的记录留作断点，补齐后重试续跑。
      const remaining = queue
        .slice(queue.findIndex((item) => Number(item.id) === Number(row.id)))
        .map((item) => Number(item.id))
      writeQcCheckpoint(remaining)
      items.push({ id: Number(row.id), 检验编号: text(row.检验编号), ok: false, message: result.message })
      blockedCount += 1
      const skipped = items.filter((item) => item.skipped).length
      return {
        items,
        passed,
        rejected,
        blocked: blockedCount,
        skipped,
        hasCheckpoint: true,
        empty: false,
      }
    }
    if (result.verdict === '合格') {
      passed += 1
    } else {
      rejected += 1
    }
    items.push({
      id: Number(row.id),
      检验编号: text(row.检验编号),
      ok: true,
      verdict: result.verdict,
      message: result.message,
    })
    // 每处理一条就刷新断点：重试只跑剩下没判定的记录。
    const processed = items.filter((item) => !item.skipped).map((item) => item.id)
    writeQcCheckpoint(queue.map((item) => Number(item.id)).filter((id) => !processed.includes(id)))
  }

  clearQcCheckpoint()
  const skipped = items.filter((item) => item.skipped).length
  return {
    items,
    passed,
    rejected,
    blocked: blockedCount,
    skipped,
    hasCheckpoint: false,
    empty: queue.length === 0,
  }
}

export function hasQcCheckpoint(): boolean {
  return readQcCheckpoint().length > 0
}

/** 留样清单读出时挂上成品检验同源字段，列表与详情共用。 */
export function attachQcToRetainSamples(samples: EntryRow[]): EntryRow[] {
  const qcRows = load()
  return samples.map((sample) => {
    const matched = qcRows.find((row) => text(row.产品批号) === text(sample.对应批号))
    return {
      ...sample,
      成品检验编号: text(sample.成品检验编号) || (matched ? matched.检验编号 : ''),
      检验结论: text(sample.检验结论) || (matched ? matched.判定结论 : ''),
    }
  })
}

export { RESULT_FIELDS }
