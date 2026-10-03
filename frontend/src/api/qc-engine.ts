/**
 * 成品检验判定引擎：检验结果、标准规定、判定结论的唯一来源。
 * 列表、详情、批量判定、存量数据回填都走这里，任何入口算出来的结论都一致。
 */

export type QcIssueCode =
  | 'STANDARD_MISSING' // 标准规定空缺：单独拦下，提示补齐
  | 'RESULT_EMPTY' // 检验结果空缺：不能凭空判定
  | 'RESULT_NONNUMERIC' // 数值限度下结果填的不是数字
  | 'RESULT_NONPOSITIVE' // 实测值为零或负数：非法值，必须重填

export type QcVerdict = '合格' | '不合格'

export type QcEvaluation = { ok: true; verdict: QcVerdict } | { ok: false; issue: QcIssueCode }

const ISSUE_MESSAGES: Record<QcIssueCode, string> = {
  STANDARD_MISSING: '标准规定空缺，已单独拦下，请先补齐标准规定后再判定',
  RESULT_EMPTY: '检验结果为空，请先填写实测结果后再判定',
  RESULT_NONNUMERIC: '标准为数值限度，检验结果需填写实测数字，请重新填写',
  RESULT_NONPOSITIVE: '检验结果为零或负数，属非法实测值，请重新填写实测结果',
}

export function issueMessage(code: QcIssueCode, code2?: string): string {
  const prefix = code2 ? `检验编号 ${code2}：` : ''
  return prefix + ISSUE_MESSAGES[code]
}

function asText(value: unknown): string {
  return String(value ?? '').trim()
}

/** 只接受「纯数字 / 百分数」形式，像 1.8、-1.2、98.6% 这样的实测读数。 */
const PURE_NUMBER_RE = /^[+-]?\d+(?:\.\d+)?\s*[%％]?$/

function numericOf(value: string): number | null {
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  const num = Number(matched[0])
  return Number.isFinite(num) ? num : null
}

/** 区间限度：95.0~105.0、5.0-7.0、95.0%～105.0%。 */
const RANGE_RE = /(-?\d+(?:\.\d+)?)\s*(?:~|～|至|—|-)\s*(-?\d+(?:\.\d+)?)/

/** 单边限度：≤1.0、≥80%、<0.5、= 5.0。 */
const COMPARATOR_RE = /(≤|≥|<=|>=|<|>|=|＝)\s*(-?\d+(?:\.\d+)?)/

function matchRange(standard: string): [number, number] | null {
  const matched = standard.match(RANGE_RE)
  if (!matched) {
    return null
  }
  return [Number(matched[1]), Number(matched[2])]
}

function matchComparator(standard: string): { operator: string; limit: number } | null {
  const matched = standard.match(COMPARATOR_RE)
  if (!matched) {
    return null
  }
  const operator = matched[1] === '＝' ? '=' : matched[1]
  return { operator, limit: Number(matched[2]) }
}

function within(operator: string, value: number, limit: number): boolean {
  switch (operator) {
    case '≤':
    case '<=':
      return value <= limit
    case '≥':
    case '>=':
      return value >= limit
    case '<':
      return value < limit
    case '>':
      return value > limit
    case '=':
      return value === limit
    default:
      return false
  }
}

/** 定性判定：应澄清、应与对照品一致、应无菌/应无检出。 */
function qualitativePass(standard: string, result: string): boolean {
  const expected = standard
    .replace(/[。；;，,].*$/, '')
    .replace(/^应(?:为|与)?/, '')
    .trim()
  if (expected.includes('无') || expected.includes('未检出')) {
    if (result.includes('有')) {
      return false
    }
    return /无|未检出/.test(result)
  }
  return result.includes(expected) || expected.includes(result)
}

/**
 * 按「标准规定 + 检验结果」推导判定结论。
 * 任何不合规输入都返回具体 issue，由调用方拦下并提示，绝不放行。
 */
export function evaluateQc(standard: unknown, result: unknown): QcEvaluation {
  const spec = asText(standard)
  const measured = asText(result)

  if (!spec) {
    return { ok: false, issue: 'STANDARD_MISSING' }
  }
  if (!measured) {
    return { ok: false, issue: 'RESULT_EMPTY' }
  }

  const range = matchRange(spec)
  const comparator = matchComparator(spec)

  if (range || comparator) {
    const num = numericOf(measured)
    if (num === null) {
      return { ok: false, issue: 'RESULT_NONNUMERIC' }
    }
    if (num <= 0) {
      return { ok: false, issue: 'RESULT_NONPOSITIVE' }
    }
    if (range) {
      const [lower, upper] = range
      return { ok: true, verdict: num >= lower && num <= upper ? '合格' : '不合格' }
    }
    const { operator, limit } = comparator as { operator: string; limit: number }
    return { ok: true, verdict: within(operator, num, limit) ? '合格' : '不合格' }
  }

  // 定性标准下填进零或负数同样是非法值。
  if (PURE_NUMBER_RE.test(measured.replace(/\s/g, ''))) {
    const num = numericOf(measured)
    if (num !== null && num <= 0) {
      return { ok: false, issue: 'RESULT_NONPOSITIVE' }
    }
  }

  return { ok: true, verdict: qualitativePass(spec, measured) ? '合格' : '不合格' }
}

/** 老示例数据里「成品检验样例N」这类占位值，迁移时按空缺处理。 */
const PLACEHOLDER_RE = /^成品检验样例\d*$/

export function isPlaceholderValue(value: unknown): boolean {
  return PLACEHOLDER_RE.test(asText(value))
}
