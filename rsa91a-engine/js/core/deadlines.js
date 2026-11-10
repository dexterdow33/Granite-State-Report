/*
 * RSA91A-Engine: business-day deadline math.
 *
 * RSA 91-A:4, IV(b): when a record is not immediately available, the public
 * body or agency must, "within 5 business days of a request," make the record
 * available, deny the request (with the written statement IV(c) requires), or
 * provide a written statement of the time reasonably necessary to decide, the
 * reason for the delay, and an itemized estimate of any paragraph VIII charge.
 *
 * Counting convention (configurable): the day the request is received is day 0;
 * the next business day is day 1. Weekends and any dates on the holiday list
 * are skipped. The statute does not define the counting method; the user
 * chooses and confirms it in Settings.
 *
 * Dates are ISO strings (YYYY-MM-DD) handled in UTC so results never shift
 * with the viewer's time zone.
 */
(function (root) {
  'use strict';

  function parseISO(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      throw new Error('Expected a date as YYYY-MM-DD, got: ' + iso);
    }
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      throw new Error('Not a real calendar date: ' + iso);
    }
    return dt;
  }

  function toISO(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function addDays(dt, n) {
    const c = new Date(dt.getTime());
    c.setUTCDate(c.getUTCDate() + n);
    return c;
  }

  function isWeekend(dt) {
    const day = dt.getUTCDay();
    return day === 0 || day === 6;
  }

  function isBusinessDay(dt, holidaySet) {
    return !isWeekend(dt) && !holidaySet.has(toISO(dt));
  }

  /**
   * Adds `n` business days to `startISO`.
   * options.countReceiptDay: if true and the receipt day is itself a business
   * day, it counts as day 1. Default false (receipt day is day 0).
   */
  function addBusinessDays(startISO, n, holidays, options) {
    const opts = options || {};
    const holidaySet = new Set(holidays || []);
    let dt = parseISO(startISO);
    let counted = 0;
    if (opts.countReceiptDay && isBusinessDay(dt, holidaySet)) {
      counted = 1;
      if (counted >= n) return toISO(dt);
    }
    while (counted < n) {
      dt = addDays(dt, 1);
      if (isBusinessDay(dt, holidaySet)) counted++;
    }
    return toISO(dt);
  }

  /** Business days from a to b (exclusive of a, inclusive of b). Negative if b < a. */
  function businessDaysBetween(aISO, bISO, holidays) {
    const holidaySet = new Set(holidays || []);
    let a = parseISO(aISO);
    const b = parseISO(bISO);
    if (a.getTime() === b.getTime()) return 0;
    const sign = b > a ? 1 : -1;
    let count = 0;
    while (a.getTime() !== b.getTime()) {
      a = addDays(a, sign);
      if (isBusinessDay(a, holidaySet)) count += sign;
    }
    return count;
  }

  function nthWeekday(year, month, weekday, n) {
    // month 0-based; n >= 1, or -1 for last
    if (n > 0) {
      const first = new Date(Date.UTC(year, month, 1));
      const offset = (weekday - first.getUTCDay() + 7) % 7;
      return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
    }
    const last = new Date(Date.UTC(year, month + 1, 0));
    const offset = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
  }

  function observed(dt) {
    const day = dt.getUTCDay();
    if (day === 6) return addDays(dt, -1);
    if (day === 0) return addDays(dt, 1);
    return dt;
  }

  /**
   * U.S. federal holidays (5 U.S.C. 6103 list) with weekend observance.
   * New Hampshire's state holiday calendar is not identical; this is only a
   * starting point the user must check against the agency's own calendar.
   */
  function federalHolidays(year) {
    const list = [
      ['New Year\'s Day', observed(new Date(Date.UTC(year, 0, 1)))],
      ['Birthday of Martin Luther King, Jr.', nthWeekday(year, 0, 1, 3)],
      ['Washington\'s Birthday', nthWeekday(year, 1, 1, 3)],
      ['Memorial Day', nthWeekday(year, 4, 1, -1)],
      ['Juneteenth National Independence Day', observed(new Date(Date.UTC(year, 5, 19)))],
      ['Independence Day', observed(new Date(Date.UTC(year, 6, 4)))],
      ['Labor Day', nthWeekday(year, 8, 1, 1)],
      ['Columbus Day', nthWeekday(year, 9, 1, 2)],
      ['Veterans Day', observed(new Date(Date.UTC(year, 10, 11)))],
      ['Thanksgiving Day', nthWeekday(year, 10, 4, 4)],
      ['Christmas Day', observed(new Date(Date.UTC(year, 11, 25)))],
    ];
    return list.map(([name, dt]) => ({ name, date: toISO(dt) }));
  }

  /**
   * Status of a request against the 5-business-day response window.
   * Returns { dueDate, businessDaysLeft, state } where state is one of
   * 'answered', 'overdue', 'due-today', 'open'.
   */
  function responseStatus(request, todayISO, settings) {
    const s = settings || {};
    const dueDate = addBusinessDays(request.receivedDate, 5, s.holidays, {
      countReceiptDay: !!s.countReceiptDay,
    });
    const answered = Boolean(request.firstResponseDate);
    if (answered) {
      const late = request.firstResponseDate > dueDate;
      return { dueDate, businessDaysLeft: null, state: late ? 'answered-late' : 'answered' };
    }
    const left = businessDaysBetween(todayISO, dueDate, s.holidays);
    let state = 'open';
    if (todayISO > dueDate) state = 'overdue';
    else if (todayISO === dueDate) state = 'due-today';
    return { dueDate, businessDaysLeft: left, state };
  }

  function todayISO() {
    const now = new Date();
    return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  }

  const api = {
    parseISO, toISO, addBusinessDays, businessDaysBetween, federalHolidays,
    responseStatus, todayISO, isWeekend,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RSA91A = root.RSA91A || {}; root.RSA91A.deadlines = api; }
})(typeof self !== 'undefined' ? self : this);
