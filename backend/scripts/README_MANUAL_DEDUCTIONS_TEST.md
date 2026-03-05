# Manual Deductions & Payroll – Test Scripts

## Prerequisites

- Backend server running: `npm run dev` (or `node server.js`) from `backend/`
- MongoDB with at least one **active employee** and a **super admin user** (e.g. seeded via `seedSuperAdmin.js`)

## 1. Node test script (full flow)

From repo root or from `backend/`:

```bash
cd backend
node scripts/test_manual_deductions_and_payroll.js
```

**Environment (backend/.env):**

- `API_BASE` – default `http://localhost:5000`
- `SUPER_ADMIN_EMAIL` – e.g. `admin@hrms.com`
- `SUPER_ADMIN_PASSWORD` – e.g. `Admin@123`

If **login returns 401**, set the above in `.env` to match your seeded admin (or run `node scripts/seedSuperAdmin.js` and use those credentials).

**What it tests:**

1. Login (POST /api/auth/login)
2. Get first employee (GET /api/employees)
3. Create direct deduction (POST /api/manual-deductions)
4. Get deduction by ID (GET /api/manual-deductions/:id)
5. Get deductions list (GET /api/manual-deductions)
6. Get employee pending deductions (GET /api/manual-deductions/employee/:id/pending)
7. Get deductions for payroll (GET /api/manual-deductions/for-payroll)
8. Transition deduction to approved (4× PUT /api/manual-deductions/:id/transition)
9. Calculate payroll with deductions (POST /api/payroll/calculate?strategy=new) – same body shape as frontend
10. Get deduction stats (GET /api/manual-deductions/stats/summary)

Exit code: `0` if all steps pass, `1` if any fail.

## 2. Postman collection

Import `scripts/postman_manual_deductions_and_payroll.json` into Postman.

**Collection variables:**

- `baseUrl`: `http://localhost:5000`
- `admin_email`: your super admin email
- `admin_password`: your super admin password

Run **1. Login** first; the script will set `token`. **2. Get first employee** sets `employeeId`. **3. Create direct deduction** sets `deductionId`. Then run **8a–8d** to approve, and **9. Calculate payroll** to verify the same payload the frontend sends (including `deductions: [{ deductionId, amount }]`).

## Frontend payload (for reference)

Pay register calls:

- `POST /api/payroll/calculate?strategy=new`
- Body: `{ employeeId, month, arrears: [...], deductions: [{ deductionId, amount }] }`

Backend expects `req.body.deductions` and passes it as `deductionSettlements` into the payroll engine; manual deduction amount is applied to the payroll record and `manualDeductionsAmount` is returned in the response.
