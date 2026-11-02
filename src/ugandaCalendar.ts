export type Holiday = { name: string; date: string; confirmed: boolean }
export type SchoolCalendar = { year: number; version: number; terms: { name: string; start: string; end: string }[]; weekdays: number[]; holidays: Holiday[] }
export const holidaySource = 'https://arusha.mofa.go.ug/basic-page/public-holidays'

export function defaultCalendar(year: number): SchoolCalendar {
  // Gregorian Easter (Meeus algorithm); do not reuse a previous year's dates.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = (h + l - 7 * m + 114) % 31 + 1
  const easter = (offset: number) => new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10)
  const fixed = [['01-01', "New Year’s Day"], ['01-26', 'NRM Liberation Day'], ['02-16', 'Archbishop Janani Luwum Day'], ['03-08', 'International Women’s Day'], ['05-01', 'Labour Day'], ['06-03', 'Uganda Martyrs’ Day'], ['06-09', 'National Heroes’ Day'], ['10-09', 'Independence Day'], ['12-25', 'Christmas Day'], ['12-26', 'Boxing Day']]
  const holidays: Holiday[] = fixed.map(([date, name]) => ({ name, date: `${year}-${date}`, confirmed: true }))
  holidays.push(...[[-2, 'Good Friday'], [0, 'Easter Sunday'], [1, 'Easter Monday']].map(([offset, name]) => ({ name: String(name), date: easter(Number(offset)), confirmed: true })))
  // Embassy estimates are suggestions only. Later years require announced dates.
  holidays.push({ name: 'Eid al-Fitr', date: year === 2026 ? '2026-03-20' : '', confirmed: false }, { name: 'Eid al-Adha', date: year === 2026 ? '2026-05-27' : '', confirmed: false })
  if (year === 2026) holidays.push(...['2026-01-15', '2026-01-16'].map(date => ({ name: 'General election public holiday (2026 only)', date, confirmed: true })))
  return { year, version: 0, terms: [], weekdays: [1, 2, 3, 4, 5], holidays }
}
export function calendarDay(date: string, calendar?: SchoolCalendar): 'unknown' | 'closed' | 'expected' | 'review' {
  if (!calendar || calendar.terms.length === 0) return 'unknown'
  if (!calendar.terms.some(t => date >= t.start && date <= t.end)) return 'closed'
  if (!calendar.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) return 'closed'
  if (calendar.holidays.some(h => h.confirmed && h.date === date)) return 'closed'
  if (calendar.holidays.some(h => !h.confirmed && h.date === date)) return 'review'
  return 'expected'
}
