/**
 * Test Manual Deductions Module & Payroll Integration
 * Run as: node scripts/test_manual_deductions_and_payroll.js
 * Requires: Backend server running (e.g. npm run dev), .env with SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
 */

const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@hrms.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function login() {
  const res = await axios.post(`${API_BASE}/api/auth/login`, {
    identifier: SUPER_ADMIN_EMAIL,
    password: SUPER_ADMIN_PASSWORD,
  });
  if (!res.data.success) throw new Error('Login failed: ' + (res.data.message || JSON.stringify(res.data)));
  return res.data.data.token;
}

async function getFirstEmployee(token) {
  const res = await axios.get(`${API_BASE}/api/employees?limit=1&is_active=true`, { headers: headers(token) });
  if (!res.data.success || !res.data.data?.length) throw new Error('No employee found');
  return res.data.data[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
  console.log('=== Manual Deductions & Payroll Integration Test ===\n');
  console.log('API_BASE:', API_BASE);
  console.log('');

  let token;
  let deductionId;
  let employeeId;
  const results = { pass: 0, fail: 0 };

  try {
    token = await login();
    console.log('1. LOGIN ...................................................... OK');
    results.pass++;
  } catch (e) {
    console.log('1. LOGIN ...................................................... FAIL');
    console.error('   ', e.message);
    if (e.response?.status === 401) {
      console.error('   Hint: Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in backend/.env to match your seeded admin (e.g. run seedSuperAdmin.js first).');
    }
    results.fail++;
    process.exit(1);
  }

  try {
    const emp = await getFirstEmployee(token);
    employeeId = emp._id;
    console.log('2. GET EMPLOYEE (for deduction) ............................. OK');
    console.log('   Employee:', emp.emp_no || emp.employee_name, employeeId);
    results.pass++;
  } catch (e) {
    console.log('2. GET EMPLOYEE .............................................. FAIL');
    console.error('   ', e.message);
    results.fail++;
    process.exit(1);
  }

  // --- Manual Deductions: Create Direct ---
  try {
    const createRes = await axios.post(
      `${API_BASE}/api/manual-deductions`,
      {
        type: 'direct',
        employee: employeeId,
        totalAmount: 500,
        reason: 'Test script direct deduction',
      },
      { headers: headers(token) }
    );
    assert(createRes.data.success, createRes.data.message || 'Create failed');
    deductionId = createRes.data.data?._id || createRes.data.data?.id;
    assert(deductionId, 'No deduction id in response');
    console.log('3. POST /manual-deductions (direct) .......................... OK');
    console.log('   Deduction ID:', deductionId);
    results.pass++;
  } catch (e) {
    console.log('3. POST /manual-deductions (direct) .......................... FAIL');
    console.error('   ', e.response?.data || e.message);
    results.fail++;
  }

  // --- Get by ID ---
  if (deductionId) {
    try {
      const getRes = await axios.get(`${API_BASE}/api/manual-deductions/${deductionId}`, { headers: headers(token) });
      assert(getRes.data.success && getRes.data.data);
      assert(getRes.data.data.totalAmount === 500);
      console.log('4. GET /manual-deductions/:id ............................... OK');
      results.pass++;
    } catch (e) {
      console.log('4. GET /manual-deductions/:id ............................... FAIL');
      console.error('   ', e.response?.data?.message || e.message);
      results.fail++;
    }
  }

  // --- Get list ---
  try {
    const listRes = await axios.get(`${API_BASE}/api/manual-deductions`, { headers: headers(token) });
    assert(listRes.data.success && Array.isArray(listRes.data.data));
    console.log('5. GET /manual-deductions (list) ............................ OK');
    console.log('   Count:', listRes.data.data.length);
    results.pass++;
  } catch (e) {
    console.log('5. GET /manual-deductions (list) ............................ FAIL');
    console.error('   ', e.response?.data?.message || e.message);
    results.fail++;
  }

  // --- Get employee pending ---
  try {
    const pendingRes = await axios.get(
      `${API_BASE}/api/manual-deductions/employee/${employeeId}/pending`,
      { headers: headers(token) }
    );
    assert(pendingRes.data.success && Array.isArray(pendingRes.data.data));
    console.log('6. GET /manual-deductions/employee/:id/pending ................. OK');
    results.pass++;
  } catch (e) {
    console.log('6. GET /manual-deductions/employee/:id/pending ................. FAIL');
    console.error('   ', e.response?.data?.message || e.message);
    results.fail++;
  }

  // --- Get for payroll (no filter) ---
  try {
    const forPayRes = await axios.get(`${API_BASE}/api/manual-deductions/for-payroll`, { headers: headers(token) });
    assert(forPayRes.data.success && Array.isArray(forPayRes.data.data));
    console.log('7. GET /manual-deductions/for-payroll ......................... OK');
    results.pass++;
  } catch (e) {
    console.log('7. GET /manual-deductions/for-payroll ......................... FAIL');
    console.error('   ', e.response?.data?.message || e.message);
    results.fail++;
  }

  // --- Transition to approved so deduction is available for payroll ---
  if (deductionId) {
    try {
      await axios.put(
        `${API_BASE}/api/manual-deductions/${deductionId}/transition`,
        { nextStatus: 'pending_hod' },
        { headers: headers(token) }
      );
      await axios.put(
        `${API_BASE}/api/manual-deductions/${deductionId}/transition`,
        { nextStatus: 'pending_hr' },
        { headers: headers(token) }
      );
      await axios.put(
        `${API_BASE}/api/manual-deductions/${deductionId}/transition`,
        { nextStatus: 'pending_admin' },
        { headers: headers(token) }
      );
      await axios.put(
        `${API_BASE}/api/manual-deductions/${deductionId}/transition`,
        { nextStatus: 'approved' },
        { headers: headers(token) }
      );
      console.log('8. PUT /manual-deductions/:id/transition (to approved) ....... OK');
      results.pass++;
    } catch (e) {
      console.log('8. PUT /manual-deductions/:id/transition ................... FAIL (may be already approved or invalid state)');
      console.error('   ', e.response?.data?.message || e.message);
      results.fail++;
    }
  }

  // --- Payroll calculate with deductions (same payload shape as frontend) ---
  const monthStr = new Date().toISOString().slice(0, 7);
  const deductionPayload = deductionId ? [{ deductionId, amount: 100 }] : [];
  try {
    const payload = {
      employeeId,
      month: monthStr,
      arrears: [],
      deductions: deductionPayload,
    };
    const calcRes = await axios.post(
      `${API_BASE}/api/payroll/calculate?strategy=new`,
      payload,
      { headers: headers(token) }
    );
    assert(calcRes.data && calcRes.data.success !== false);
    const record = calcRes.data.data || calcRes.data.payrollRecord || calcRes.data;
    const manualDedAmt = record.manualDeductionsAmount ?? record.manualDeductions?.manualDeductionsAmount ?? 0;
    if (deductionId && deductionPayload.length > 0) {
      assert(manualDedAmt === 100, `Expected manualDeductionsAmount 100, got ${manualDedAmt}`);
      console.log('9. POST /payroll/calculate (with deductions) ................. OK');
      console.log('   manualDeductionsAmount:', manualDedAmt);
    } else {
      console.log('9. POST /payroll/calculate (with deductions) ................. OK');
      console.log('   (no deduction in payload; manualDeductionsAmount:', manualDedAmt, ')');
    }
    results.pass++;
  } catch (e) {
    console.log('9. POST /payroll/calculate (with deductions) ................. FAIL');
    console.error('   ', e.response?.data?.message || e.response?.data?.error || e.message);
    if (e.response?.data) console.error('   Body:', JSON.stringify(e.response.data).slice(0, 300));
    results.fail++;
  }

  // --- Stats ---
  try {
    const statsRes = await axios.get(`${API_BASE}/api/manual-deductions/stats/summary`, { headers: headers(token) });
    assert(statsRes.data.success);
    console.log('10. GET /manual-deductions/stats/summary ...................... OK');
    results.pass++;
  } catch (e) {
    console.log('10. GET /manual-deductions/stats/summary ..................... FAIL');
    console.error('   ', e.response?.data?.message || e.message);
    results.fail++;
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('Passed:', results.pass);
  console.log('Failed:', results.fail);
  process.exit(results.fail > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
