/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 成品检验判定引擎对一条记录的体检结果。 */
export type QcRowCheck =
  | { ok: true; verdict: '合格' | '不合格' }
  | { ok: false; issue: 'STANDARD_MISSING' | 'RESULT_EMPTY' | 'RESULT_NONNUMERIC' | 'RESULT_NONPOSITIVE' }

/** 批量判定的逐条结果，失败项带原因，供「从断点续跑」使用。 */
export type BatchJudgeItem = {
  id: number
  检验编号: string
  ok: boolean
  message: string
  verdict?: '合格' | '不合格'
  skipped?: boolean
}

export type BatchJudgeReport = {
  items: BatchJudgeItem[]
  /** 本次（含续跑）判定合格/不合格的条数 */
  passed: number
  rejected: number
  /** 因标准规定空缺等被拦下、需要补齐的条数 */
  blocked: number
  /** 处理时已离开「检验中」、本轮跳过的条数 */
  skipped: number
  /** 是否还有断点，为 true 时可直接重试从断点续跑 */
  hasCheckpoint: boolean
  /** 当前没有任何处于「检验中」、可判定的记录 */
  empty: boolean
}
