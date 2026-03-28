#!/usr/bin/env node
/**
 * Duplicate leave days (IST): detect overlapping requests per employee per calendar day,
 * then plan deletions with explicit rules. Default is DRY RUN (no DB writes).
 *
 * Default inclusive calendar range: 2025-12-01 through 2026-02-25 (IST dates). Override with START_MONTH / END_DATE.
 *
 * Detection
 * - Full-day leave uses both halves; half-day uses first_half or second_half only.
 * - Two rows overlap on a day if their half masks intersect (full overlaps any half).
 *
 * Keep / delete (per connected overlap cluster on same employee + date)
 * 1) If any row is active (isActive !== false), delete inactive duplicates (isActive === false).
 * 2) If any row is status "approved", delete every row that is not exactly "approved"
 *    (rejected, pending, hod_rejected, cancelled, draft, in-approval, etc.).
 * 3) If multiple active + approved rows remain, keep the earliest createdAt, delete the rest.
 * 4) If the cluster is only inactive + all approved (no active row), keep earliest createdAt, delete the rest.
 *
 * Skipped clusters (logged, no delete): e.g. only pending/rejected with no final "approved",
 * or single row after rules.
 *
 * Usage (from backend/):
 *   node scripts/report_duplicate_leave_days_by_month.js
 *   END_DATE=2026-02-28 node scripts/report_duplicate_leave_days_by_month.js
 *   node scripts/report_duplicate_leave_days_by_month.js --json
 *   node scripts/report_duplicate_leave_days_by_month.js --apply   # actually delete (+ LeaveSplit)
 *
 * Requires MONGODB_URI in .env.
 */

/* eslint-disable no-console */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const Leave = require('../leaves/model/Leave');
const LeaveSplit = require('../leaves/model/LeaveSplit');
const Employee = require('../employees/model/Employee');
const { createISTDate, extractISTComponents } = require('../shared/utils/dateUtils');

function toNormalizedDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return extractISTComponents(val).dateStr;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return extractISTComponents(new Date(val)).dateStr;
}

function parseMonth(s) {
  const m = String(s || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  return { y, mo, key: m };
}

/** Inclusive end calendar day YYYY-MM-DD */
function parseEndDate(s) {
  const t = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [ys, ms, ds] = t.split('-');
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > lastDay) return null;
  return {
    dateStr: t,
    y,
    mo,
    monthKey: `${y}-${String(mo).padStart(2, '0')}`,
  };
}

/** Intersect calendar month (y, mo) with [rangeStartStr, rangeEndStr] inclusive; null if no overlap. */
function monthWindowClamped(y, mo, rangeStartStr, rangeEndStr) {
  const full = monthBoundsUtcForCalendarMonth(y, mo);
  const startStr = [full.startStr, rangeStartStr].sort(compareDateStr)[1];
  const endStr = [full.endStr, rangeEndStr].sort(compareDateStr)[0];
  if (compareDateStr(startStr, endStr) > 0) return null;
  return {
    startStr,
    endStr,
    startDate: createISTDate(startStr, '00:00'),
    endDate: createISTDate(endStr, '23:59'),
  };
}

function monthBoundsUtcForCalendarMonth(y, mo) {
  const startStr = `${y}-${String(mo).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const endStr = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const startDate = createISTDate(startStr, '00:00');
  const endDate = createISTDate(endStr, '23:59');
  return { startStr, endStr, startDate, endDate };
}

function compareDateStr(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addDaysDateStr(dateStr, deltaDays) {
  const d = createISTDate(dateStr, '12:00');
  d.setDate(d.getDate() + deltaDays);
  return extractISTComponents(d).dateStr;
}

function daysInMonthOverlap(fromStr, toStr, monthStartStr, monthEndStr) {
  const start = [fromStr, monthStartStr].sort(compareDateStr)[1];
  const end = [toStr, monthEndStr].sort(compareDateStr)[0];
  if (compareDateStr(start, end) > 0) return [];
  const out = [];
  let cur = start;
  while (compareDateStr(cur, end) <= 0) {
    out.push(cur);
    cur = addDaysDateStr(cur, 1);
  }
  return out;
}

function* iterateMonths(fromKey, toKey) {
  let { y, mo } = parseMonth(fromKey);
  const end = parseMonth(toKey);
  while (y < end.y || (y === end.y && mo <= end.mo)) {
    yield { y, mo, label: `${y}-${String(mo).padStart(2, '0')}` };
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
}

/** Bitmask: 1 = first half, 2 = second half, 3 = full day */
function leaveDayMask(leave) {
  if (!leave.isHalfDay) return 3;
  if (leave.halfDayType === 'first_half') return 1;
  if (leave.halfDayType === 'second_half') return 2;
  return 3;
}

function maskLabel(mask) {
  if (mask === 3) return 'full';
  if (mask === 1) return '1st½';
  if (mask === 2) return '2nd½';
  return String(mask);
}

function masksOverlap(a, b) {
  return (a & b) !== 0;
}

function createdTime(leave) {
  if (leave.createdAt) return new Date(leave.createdAt).getTime();
  try {
    return new mongoose.Types.ObjectId(leave._id).getTimestamp().getTime();
  } catch {
    return 0;
  }
}

function sortByCreatedAsc(a, b) {
  const d = createdTime(a) - createdTime(b);
  if (d !== 0) return d;
  return String(a._id).localeCompare(String(b._id));
}

/**
 * Union-find connected components where edges = overlapping masks on same calendar day.
 * @param {Array<{ leave: object, mask: number }>} items
 */
function connectedOverlapClusters(items) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    return parent[i] === i ? i : (parent[i] = find(parent[i]));
  }
  function union(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (masksOverlap(items[i].mask, items[j].mask)) union(i, j);
    }
  }
  const map = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(items[i]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/**
 * @returns {{ toDelete: Set<string>, reasons: Map<string, string[]>, skipped: boolean, note?: string }}
 */
function planClusterDeletes(clusterItems) {
  const leaves = clusterItems.map((x) => x.leave);
  const masks = clusterItems.map((x) => x.mask);
  const reasons = new Map();
  const toDelete = new Set();

  const addReason = (id, msg) => {
    const k = String(id);
    if (!reasons.has(k)) reasons.set(k, []);
    reasons.get(k).push(msg);
  };

  const hasActive = leaves.some((l) => l.isActive !== false);
  if (hasActive) {
    for (const l of leaves) {
      if (l.isActive === false) {
        toDelete.add(String(l._id));
        addReason(l._id, 'inactive duplicate (active row exists in cluster)');
      }
    }
  }

  const hasApproved = leaves.some((l) => l.status === 'approved');
  if (hasApproved) {
    for (const l of leaves) {
      if (l.status !== 'approved') {
        toDelete.add(String(l._id));
        addReason(l._id, 'not approved while another row is approved');
      }
    }
  }

  const remainingAfter = leaves.filter((l) => !toDelete.has(String(l._id)));
  const approvedActive = remainingAfter.filter((l) => l.status === 'approved' && l.isActive !== false);
  if (approvedActive.length > 1) {
    const sorted = [...approvedActive].sort(sortByCreatedAsc);
    for (let i = 1; i < sorted.length; i += 1) {
      toDelete.add(String(sorted[i]._id));
      addReason(sorted[i]._id, 'duplicate approved (keeping earliest createdAt)');
    }
  }

  const remaining2 = leaves.filter((l) => !toDelete.has(String(l._id)));
  if (!hasActive && remaining2.length > 1 && remaining2.every((l) => l.status === 'approved')) {
    const sorted = [...remaining2].sort(sortByCreatedAsc);
    for (let i = 1; i < sorted.length; i += 1) {
      toDelete.add(String(sorted[i]._id));
      addReason(sorted[i]._id, 'all inactive approved duplicates (keeping earliest createdAt)');
    }
  }

  if (toDelete.size === 0) {
    return {
      toDelete,
      reasons,
      skipped: true,
      note: 'No automatic rule matched (e.g. no approved row and no active/inactive pair to resolve)',
    };
  }

  return { toDelete, reasons, skipped: false };
}

function leaveDetailLine(l) {
  const hdPart = l.isHalfDay
    ? l.halfDayType === 'first_half'
      ? 'HD:first_half '
      : l.halfDayType === 'second_half'
        ? 'HD:second_half '
        : 'HD '
    : '';
  const fromStr = toNormalizedDateStr(l.fromDate);
  const toStr = toNormalizedDateStr(l.toDate);
  return `${l._id}  ${l.leaveType}  [${l.status}]  active=${l.isActive !== false}  ${hdPart}range ${fromStr} .. ${toStr}`;
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    apply: argv.includes('--apply'),
  };
}

async function run() {
  const { json, apply } = parseArgs(process.argv.slice(2));

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI (or MONGO_URI) in environment / .env');
    process.exit(1);
  }

  const startM = parseMonth(process.env.START_MONTH || '2025-12');
  if (!startM) {
    console.error('Invalid START_MONTH; use YYYY-MM (default 2025-12)');
    process.exit(1);
  }

  const rangeStartStr = `${startM.y}-${String(startM.mo).padStart(2, '0')}-01`;
  const endD = parseEndDate(process.env.END_DATE || '2026-02-25');
  if (!endD) {
    console.error('Invalid END_DATE; use YYYY-MM-DD (default 2026-02-25)');
    process.exit(1);
  }

  if (compareDateStr(rangeStartStr, endD.dateStr) > 0) {
    console.error('START_MONTH begins after END_DATE');
    process.exit(1);
  }

  const endMonthKey = endD.monthKey;
  if (startM.key > endMonthKey) {
    console.error('START_MONTH must be on or before the month of END_DATE');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  /** @type Map<string, { reasons: string[], month: string, date: string, slot: string }> */
  const globalDeleteMeta = new Map();
  /** @type Array<{ employeeId, emp_no, employee_name, month, date, slot, keeping: object[], deleting: object[], skipped?: boolean, skipNote?: string }> */
  const tableRows = [];

  const summaryByMonth = [];

  for (const { y, mo, label } of iterateMonths(startM.key, endMonthKey)) {
    const win = monthWindowClamped(y, mo, rangeStartStr, endD.dateStr);
    if (!win) continue;

    const { startStr: monthStartStr, endStr: monthEndStr, startDate, endDate } = win;

    const leaves = await Leave.find({
      fromDate: { $lte: endDate },
      toDate: { $gte: startDate },
    })
      .select(
        '_id employeeId emp_no fromDate toDate leaveType status isHalfDay halfDayType numberOfDays isActive createdAt'
      )
      .lean();

    /** emp -> date -> Map leaveId -> { leave, mask } */
    const byEmpDay = new Map();

    for (const row of leaves) {
      const empKey = String(row.employeeId);
      const fromStr = toNormalizedDateStr(row.fromDate);
      const toStr = toNormalizedDateStr(row.toDate);
      const days = daysInMonthOverlap(fromStr, toStr, monthStartStr, monthEndStr);
      const mask = leaveDayMask(row);

      for (const d of days) {
        if (!byEmpDay.has(empKey)) byEmpDay.set(empKey, new Map());
        const dayMap = byEmpDay.get(empKey);
        if (!dayMap.has(d)) dayMap.set(d, new Map());
        dayMap.get(d).set(String(row._id), { leave: row, mask });
      }
    }

    const empIdsThisMonth = [...byEmpDay.keys()].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const empDocs =
      empIdsThisMonth.length > 0
        ? await Employee.find({ _id: { $in: empIdsThisMonth } })
            .select('_id emp_no employee_name')
            .lean()
        : [];
    const empLookupMonth = new Map(empDocs.map((e) => [String(e._id), e]));

    const monthClusters = [];

    for (const [empId, dayMap] of byEmpDay) {
      for (const [dateStr, idMap] of dayMap) {
        const items = [...idMap.values()];
        if (items.length < 2) continue;

        const clusters = connectedOverlapClusters(items);
        for (const cluster of clusters) {
          const plan = planClusterDeletes(cluster);
          const maskDesc = [...new Set(cluster.map((c) => maskLabel(c.mask)))].join('+');

          const keeping = cluster
            .map((c) => c.leave)
            .filter((l) => !plan.toDelete.has(String(l._id)));
          const deleting = cluster
            .map((c) => c.leave)
            .filter((l) => plan.toDelete.has(String(l._id)));

          monthClusters.push({
            employeeId: empId,
            date: dateStr,
            slot: maskDesc,
            skipped: plan.skipped,
            skipNote: plan.note,
            keepingIds: keeping.map((l) => String(l._id)),
            deletingIds: deleting.map((l) => String(l._id)),
          });

          if (!plan.skipped) {
            for (const id of plan.toDelete) {
              const rs = plan.reasons.get(id) || [];
              if (!globalDeleteMeta.has(id)) {
                globalDeleteMeta.set(id, { reasons: [], month: label, date: dateStr, slot: maskDesc });
              }
              const meta = globalDeleteMeta.get(id);
              meta.reasons.push(...rs.map((r) => `${label}/${dateStr}: ${r}`));
            }
          }

          const emp = empLookupMonth.get(empId);
          tableRows.push({
            employeeId: empId,
            emp_no: emp?.emp_no ?? '—',
            employee_name: emp?.employee_name ?? '—',
            month: label,
            date: dateStr,
            slot: maskDesc,
            keeping,
            deleting,
            skipped: plan.skipped,
            skipNote: plan.note,
          });
        }
      }
    }

    summaryByMonth.push({
      month: label,
      monthLabel: `${String(mo).padStart(2, '0')}/${y}`,
      calendarRange: `${monthStartStr} .. ${monthEndStr}`,
      leavesScanned: leaves.length,
      overlapClusters: monthClusters.length,
      clusters: monthClusters,
    });
  }

  const deleteIds = [...globalDeleteMeta.keys()];
  const uniqueDeleteCount = deleteIds.length;

  let applyResult = null;
  if (apply && uniqueDeleteCount > 0) {
    const oids = deleteIds.map((id) => new mongoose.Types.ObjectId(id));
    const splitRes = await LeaveSplit.deleteMany({ leaveId: { $in: oids } });
    const leaveRes = await Leave.deleteMany({ _id: { $in: oids } });
    applyResult = { leaveSplitsRemoved: splitRes.deletedCount, leavesRemoved: leaveRes.deletedCount };
  }

  await mongoose.disconnect();

  if (json) {
    const out = {
      startMonth: startM.key,
      endMonth: endMonthKey,
      rangeStartDate: rangeStartStr,
      endDateInclusive: endD.dateStr,
      dryRun: !apply,
      plannedDeleteCount: uniqueDeleteCount,
      plannedDeleteIds: deleteIds,
      deleteMeta: Object.fromEntries(
        [...globalDeleteMeta.entries()].map(([id, m]) => [id, { ...m, reasons: m.reasons }])
      ),
      employeeRows: tableRows,
      months: summaryByMonth,
    };
    if (applyResult) out.applyResult = applyResult;
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('Duplicate leave cleanup plan (IST calendar months)');
  console.log(`Inclusive dates: ${rangeStartStr} .. ${endD.dateStr}  (months ${startM.key} .. ${endMonthKey})`);
  console.log('Markers: • = keep   X = planned delete');
  console.log(apply ? 'MODE: APPLY (documents will be removed)' : 'MODE: DRY RUN (no deletes)');
  console.log('');

  if (tableRows.length === 0) {
    console.log('No overlapping duplicate clusters in this range (or only single-row days after half-day split).');
    console.log('');
  }

  for (const block of summaryByMonth) {
    const rowsInMonth = tableRows.filter((r) => r.month === block.month);
    if (rowsInMonth.length === 0) continue;

    rowsInMonth.sort((a, b) => {
      const c = compareDateStr(a.date, b.date);
      if (c !== 0) return c;
      return `${a.emp_no}`.localeCompare(`${b.emp_no}`);
    });

    console.log('═'.repeat(72));
    console.log(`Month ${block.month} (${block.monthLabel})  ${block.calendarRange}`);
    console.log(`  Leaves overlapping month: ${block.leavesScanned}`);
    console.log(`  Overlap clusters: ${block.overlapClusters}`);

    let lastEmp = '';
    for (const r of rowsInMonth) {
      const header = `${r.employee_name} (${r.emp_no})`;
      if (header !== lastEmp) {
        console.log(`\n  ${header}`);
        lastEmp = header;
      }

      const allInCluster = [...r.keeping, ...r.deleting];
      const n = allInCluster.length;

      if (r.skipped) {
        console.log(`    ${r.date}  [${r.slot}] — SKIPPED (${n} requests): ${r.skipNote || ''}`);
        for (const l of allInCluster) {
          console.log(`      • ${leaveDetailLine(l)}`);
        }
      } else {
        console.log(`    ${r.date}  [${r.slot}] — ${n} requests:`);
        for (const l of r.keeping) {
          console.log(`      • ${leaveDetailLine(l)}`);
        }
        for (const l of r.deleting) {
          console.log(`      X ${leaveDetailLine(l)}`);
        }
      }
    }
    console.log('');
  }

  console.log('═'.repeat(72));
  console.log(`Summary: ${uniqueDeleteCount} distinct leave document(s) marked for DELETE across all months.`);
  if (uniqueDeleteCount > 0) {
    console.log('');
    console.log('Delete IDs (full):');
    for (const id of deleteIds.sort()) {
      const meta = globalDeleteMeta.get(id);
      console.log(`  ${id}`);
      if (meta?.reasons?.length) meta.reasons.forEach((r) => console.log(`      → ${r}`));
    }
  }
  if (!apply && uniqueDeleteCount > 0) {
    console.log('');
    console.log('Run with --apply to remove these leaves and related LeaveSplit rows (after reviewing the list above).');
  }
  if (apply && applyResult) {
    console.log('');
    console.log('Apply result:', applyResult);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
