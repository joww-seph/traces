// People's names: one way of writing them everywhere, and the short name and account email made from them.

const ROMAN = /^(II|III|IV|V|VI|VII|VIII|IX|X)$/
const TITLES = new Set(['engr', 'enrg', 'dr', 'atty', 'mr', 'ms', 'mrs', 'hon', 'prof', 'arch', 'sir', 'maam', 'dir', 'usec', 'asec'])
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
const PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'della', 'di', 'da', 'van', 'von', 'la', 'las', 'los', 'san', 'santa', 'sta', 'sto', 'st', 'du', 'le'])
const bare = (t: string) => t.toLowerCase().replace(/[.']/g, '')

// A word typed all in capitals or all in small letters gets a capital first letter; a mixed word (McKay) is kept.
function capWord(w: string) {
  if (ROMAN.test(w)) return w
  const letters = w.replace(/[^A-Za-z]/g, '')
  if (letters.length <= 1) return w.toUpperCase() // an initial
  const allUpper = letters === letters.toUpperCase(), allLower = letters === letters.toLowerCase()
  if (!allUpper && !allLower) return w
  return w.toLowerCase().replace(/(^|[-'])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

const NICKNAME = /^["'(\[].*["')\]]$/ // a nickname in quotes or brackets is kept exactly as typed

export function titleCaseName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => (NICKNAME.test(w) ? w : capWord(w))).join(' ')
}

// First letter of the first given name + the middle initial + the surname: "Ana Marie B. Dela Cruz" -> "ABDelaCruz".
export function shortNameOf(fullName: string): string {
  let t = titleCaseName(fullName).split(' ').filter((x) => !NICKNAME.test(x))
  while (t.length > 1 && TITLES.has(bare(t[0]))) t = t.slice(1)
  while (t.length > 1 && SUFFIXES.has(bare(t[t.length - 1]))) t = t.slice(0, -1)
  if (!t.length) return ''
  let given: string[], middle = '', surname: string[]
  const mi = t.map((x, i) => (i > 0 && i < t.length - 1 && /^[A-Za-z]\.?$/.test(x) ? i : -1)).filter((i) => i >= 0).pop()
  if (mi !== undefined) {
    given = t.slice(0, mi); middle = t[mi][0].toUpperCase(); surname = t.slice(mi + 1)
  } else {
    let start = t.length - 1
    while (start > 1 && PARTICLES.has(bare(t[start - 1]))) start--
    given = t.slice(0, start); surname = t.slice(start)
    if (!given.length) { given = []; surname = t }
  }
  const initials = (given[0]?.match(/[A-Za-z0-9]/)?.[0] ?? '').toUpperCase() // a second or third given name does not count
  return initials + middle + surname.join('').replace(/[^A-Za-z0-9-]/g, '')
}

export const ACCOUNT_DOMAIN = 'region1.dost.gov.ph'
export const accountEmailOf = (fullName: string) => `${shortNameOf(fullName).toLowerCase()}@${ACCOUNT_DOMAIN}`
