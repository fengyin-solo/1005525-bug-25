/**
 * 检验结果与标准规定的判定引擎（唯一判定来源）。
 * 判定结论只能由本模块比对「标准规定」与「检验结果」产出，页面不允许手工写死，
 * 这样列表、详情面板、导出、留样联动拿到的结论永远同源。
 */

export type EvaluateCode =
  | 'SPEC_MISSING' // 标准规定为空
  | 'RESULT_MISSING' // 检验结果未登记
  | 'RESULT_INVALID' // 结果为负数等非法值
  | 'SPEC_UNRECOGNIZED' // 标准规定写不出比较规则
  | 'TYPE_MISMATCH' // 数值结果配了定性标准（或反过来）

export type EvaluateOutcome =
  | { ok: true; verdict: '合格' | '不合格'; reason: string }
  | { ok: false; code: EvaluateCode; message: string }

export const ISSUE_MESSAGE: Record<EvaluateCode, string> = {
  SPEC_MISSING: '标准规定为空，请先补齐标准规定再判定',
  RESULT_MISSING: '检验结果尚未登记，请先录入实测结果',
  RESULT_INVALID: '检验结果为负数或不是有效数值，属于非法值，请重填后再判定',
  SPEC_UNRECOGNIZED: '标准规定缺少可判定的比较规则（如 ≥、≤、a~b 或“符合规定”），请补齐后再判定',
  TYPE_MISMATCH: '检验结果的类型与标准规定不匹配，请按标准核对并重填结果',
}

const QUALIFIED_TEXT = ['符合规定', '符合', '合格']
const UNQUALIFIED_TEXT = ['不符合规定', '不符合', '不合格']

const NUMBER = '-?\\d+(?:\\.\\d+)?'

/** 全角转半角、去空白、符号归一，让「＞＝」「>=」「≥」都按同一规则解析。 */
function normalize(input: string): string {
  return String(input ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/至/g, '~')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
}

export function parseNumeric(raw: string | number): number | null {
  const text = normalize(String(raw ?? ''))
  if (!new RegExp(`^${NUMBER}$`).test(text)) {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

type SpecRule =
  | { kind: 'text' }
  | { kind: 'min'; limit: number; op: '>=' | '>' }
  | { kind: 'max'; limit: number; op: '<=' | '<' }
  | { kind: 'range'; low: number; high: number }
  | { kind: 'equal'; limit: number }

function parseSpec(spec: string): SpecRule | EvaluateCode {
  if (spec.includes('符合') || spec.includes('合格')) {
    return { kind: 'text' }
  }
  let match = spec.match(new RegExp(`^<=(${NUMBER})$`))
  if (match) return { kind: 'max', limit: Number(match[1]), op: '<=' }
  match = spec.match(new RegExp(`^>=(${NUMBER})$`))
  if (match) return { kind: 'min', limit: Number(match[1]), op: '>=' }
  match = spec.match(new RegExp(`^<(${NUMBER})$`))
  if (match) return { kind: 'max', limit: Number(match[1]), op: '<' }
  match = spec.match(new RegExp(`^>(${NUMBER})$`))
  if (match) return { kind: 'min', limit: Number(match[1]), op: '>' }
  match = spec.match(new RegExp(`^=(${NUMBER})$`))
  if (match) return { kind: 'equal', limit: Number(match[1]) }
  match = spec.match(new RegExp(`^(${NUMBER})~(${NUMBER})$`))
  if (match) return { kind: 'range', low: Number(match[1]), high: Number(match[2]) }
  return 'SPEC_UNRECOGNIZED'
}

/**
 * 按标准规定判定检验结果。
 * 关键点：实测 0 不会天然放行——含量标准 ≥95 时结果 0 直接判不合格；
 * 负数等非法值不参与比较，走重填流程。
 */
export function evaluateConclusion(
  specRaw: string | number | null | undefined,
  resultRaw: string | number | null | undefined,
): EvaluateOutcome {
  const spec = normalize(String(specRaw ?? ''))
  const raw = String(resultRaw ?? '').trim()

  if (spec === '') {
    return { ok: false, code: 'SPEC_MISSING', message: ISSUE_MESSAGE.SPEC_MISSING }
  }
  if (raw === '') {
    return { ok: false, code: 'RESULT_MISSING', message: ISSUE_MESSAGE.RESULT_MISSING }
  }

  const numeric = parseNumeric(raw)
  const isQualifiedText = QUALIFIED_TEXT.includes(normalize(raw))
  const isUnqualifiedText = UNQUALIFIED_TEXT.includes(normalize(raw))
  if (numeric === null && !isQualifiedText && !isUnqualifiedText) {
    return { ok: false, code: 'RESULT_INVALID', message: ISSUE_MESSAGE.RESULT_INVALID }
  }
  if (numeric !== null && numeric < 0) {
    return { ok: false, code: 'RESULT_INVALID', message: ISSUE_MESSAGE.RESULT_INVALID }
  }

  const rule = parseSpec(spec)
  if (typeof rule === 'string') {
    return { ok: false, code: rule, message: ISSUE_MESSAGE[rule] }
  }

  if (rule.kind === 'text') {
    if (numeric !== null) {
      return { ok: false, code: 'TYPE_MISMATCH', message: ISSUE_MESSAGE.TYPE_MISMATCH }
    }
    return isQualifiedText
      ? { ok: true, verdict: '合格', reason: `标准「${specRaw}」，实测「${raw}」，判定合格` }
      : { ok: true, verdict: '不合格', reason: `标准「${specRaw}」，实测「${raw}」，判定不合格` }
  }

  if (numeric === null) {
    return { ok: false, code: 'TYPE_MISMATCH', message: ISSUE_MESSAGE.TYPE_MISMATCH }
  }

  switch (rule.kind) {
    case 'min': {
      const pass = rule.op === '>=' ? numeric >= rule.limit : numeric > rule.limit
      return pass
        ? { ok: true, verdict: '合格', reason: `标准「${spec}」，实测 ${numeric}，不低于下限 ${rule.limit}，判定合格` }
        : { ok: true, verdict: '不合格', reason: `标准「${spec}」，实测 ${numeric}，低于下限 ${rule.limit}，实测零值或低值不得放行，判定不合格` }
    }
    case 'max': {
      const pass = rule.op === '<=' ? numeric <= rule.limit : numeric < rule.limit
      return pass
        ? { ok: true, verdict: '合格', reason: `标准「${spec}」，实测 ${numeric}，不高于上限 ${rule.limit}，判定合格` }
        : { ok: true, verdict: '不合格', reason: `标准「${spec}」，实测 ${numeric}，高于上限 ${rule.limit}，判定不合格` }
    }
    case 'range': {
      const pass = numeric >= rule.low && numeric <= rule.high
      return pass
        ? { ok: true, verdict: '合格', reason: `标准「${spec}」，实测 ${numeric}，落在区间 ${rule.low}~${rule.high} 内，判定合格` }
        : { ok: true, verdict: '不合格', reason: `标准「${spec}」，实测 ${numeric}，超出区间 ${rule.low}~${rule.high}，判定不合格` }
    }
    case 'equal': {
      const pass = numeric === rule.limit
      return pass
        ? { ok: true, verdict: '合格', reason: `标准「${spec}」，实测 ${numeric}，判定合格` }
        : { ok: true, verdict: '不合格', reason: `标准「${spec}」，实测 ${numeric}，不等于规定值 ${rule.limit}，判定不合格` }
    }
  }
}

/** 登记/重填时校验单个结果值：合法返回归一后的值，非法（负数、乱填）返回 null。 */
export function normalizeResult(raw: string | number): { value: string } | { error: string } {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return { error: '检验结果不能为空' }
  }
  const numeric = parseNumeric(text)
  const normalText = normalize(text)
  if (numeric === null && !QUALIFIED_TEXT.includes(normalText) && !UNQUALIFIED_TEXT.includes(normalText)) {
    return { error: ISSUE_MESSAGE.RESULT_INVALID }
  }
  if (numeric !== null && numeric < 0) {
    return { error: ISSUE_MESSAGE.RESULT_INVALID }
  }
  return { value: numeric !== null ? String(numeric) : text }
}
