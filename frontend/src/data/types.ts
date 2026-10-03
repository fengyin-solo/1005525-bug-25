/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | null | RecheckRecord[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 成品检验报告下挂的复检记录；主报告标准规定为空时连复检一起锁死。 */
export type RecheckRecord = {
  id: string
  round: number
  result: string
  verdict: '合格' | '不合格'
  reason: string
  reviewer: string
  reviewedAt: string
}

/** 判定拦截的原因码（缺标准 / 非法值 / 结果类型不匹配等），列表与详情共用。 */
export type QcIssueCode =
  | 'SPEC_MISSING'
  | 'RESULT_MISSING'
  | 'RESULT_INVALID'
  | 'SPEC_UNRECOGNIZED'
  | 'TYPE_MISMATCH'
  | null

export type BatchEvaluateResult = {
  processed: number
  passed: number
  failed: number
  blocked: number
  skipped: number
  total: number
  remaining: number
  blockedRows: { id: number; 检验编号: string; 检验项目: string; message: string }[]
  empty: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
