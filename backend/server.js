
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { initSocket } = require('./shared/services/socketService');
const { initializeAllDatabases } = require('./config/init');
const { checkConnection: checkS3Connection } = require('./shared/services/s3UploadService');

const app = express();
module.exports = app;
const PORT = process.env.PORT || 5000;

// Middleware
const logger = require('./middleware/logger');
app.use(logger); // Log all requests

const allowedOrigins = [
  "*",
  process.env.FRONTEND_URL,
  'http://192.168.3.147:3000',
  'http://192.168.3.198:3000',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root endpoint - Returns metadata
app.get('/', (req, res) => {
  res.json({
    name: 'HRMS Backend API',
    version: '1.0.0',
    status: 'running',
    message: 'HRMS Backend Server is operational',
    endpoints: {
      authentication: '/api/auth',
      employees: '/api/employees'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Import and mount module routes

const authRoutes = require('./authentication/index.js');
app.use('/api/auth', authRoutes);


const userRoutes = require('./users/index.js');
app.use('/api/users', userRoutes);


const shiftRoutes = require('./shifts/index.js');
app.use('/api/shifts', shiftRoutes);

// Departments routes
const departmentRoutes = require('./departments/index.js');
app.use('/api/departments', departmentRoutes);

// Division routes
const divisionRoutes = require('./departments/divisionRoutes.js');
app.use('/api/divisions', divisionRoutes);

// Settings routes
const settingsRoutes = require('./settings/index.js');
app.use('/api/settings', settingsRoutes);

// Employees routes
const employeeRoutes = require('./employees/index.js');
app.use('/api/employees', employeeRoutes);

const employeeGroupRoutes = require('./employees/employeeGroupRoutes.js');
app.use('/api/employee-groups', employeeGroupRoutes);

// Employee Applications routes
const employeeApplicationRoutes = require('./employee-applications/index.js');
app.use('/api/employee-applications', employeeApplicationRoutes);

// Employee Profile Update requests
const employeeUpdateRoutes = require('./employee-updates/index.js');
app.use('/api/employee-updates', employeeUpdateRoutes);

// Workspaces routes
const workspaceRoutes = require('./workspaces/index.js');
app.use('/api/workspaces', workspaceRoutes);

// Leaves and OD routes
const leaveRoutes = require('./leaves/index.js');
app.use('/api/leaves', leaveRoutes);

// Resignation policy and requests
const resignationRoutes = require('./resignations/index.js');
app.use('/api/resignations', resignationRoutes);

const loanRoutes = require('./loans/index.js');
app.use('/api/loans', loanRoutes);

// Attendance routes
const attendanceRoutes = require('./attendance/index.js');

// Internal Attendance Routes (System-to-System, No Auth)
const internalAttendanceRoutes = require('./attendance/internalRoutes.js');
// Changed path to avoid conflict with /api/attendance which has auth middleware
app.use('/api/internal/attendance', internalAttendanceRoutes);

app.use('/api/attendance', attendanceRoutes);

// Overtime routes
const otRoutes = require('./overtime/index.js');
app.use('/api/ot', otRoutes);

// Permissions routes
const permissionRoutes = require('./permissions/index.js');
app.use('/api/permissions', permissionRoutes);

// Security Gate Pass routes
const securityRoutes = require('./security/routes/securityRoutes.js');
app.use('/api/security', securityRoutes);

// Upload routes (S3 file uploads)
const uploadRoutes = require('./shared/routes/uploadRoutes');
app.use('/api/upload', uploadRoutes);

// Allowances & Deductions routes
const allowanceDeductionRoutes = require('./allowances-deductions/index.js');
app.use('/api/allowances-deductions', allowanceDeductionRoutes);

// Payroll routes
const payrollRoutes = require('./payroll/index.js');
app.use('/api/payroll', payrollRoutes);

// Pay Register routes
const payRegisterRoutes = require('./pay-register/index.js');
app.use('/api/pay-register', payRegisterRoutes);

// Arrears routes
const arrearsRoutes = require('./arrears/index.js');
app.use('/api/arrears', arrearsRoutes);

// Manual Deductions routes
const manualDeductionsRoutes = require('./manual-deductions/index.js');
app.use('/api/manual-deductions', manualDeductionsRoutes);

// PayrollBatch routes
const payrollBatchRoutes = require('./payroll/routes/payrollBatchRoutes.js');
app.use('/api/payroll-batch', payrollBatchRoutes);

// Bonus routes
const bonusRoutes = require('./bonus/routes/bonusRoutes.js');
app.use('/api/bonus', bonusRoutes);

// Holidays routes
const holidayRoutes = require('./holidays/index.js');
app.use('/api/holidays', holidayRoutes);

// Dashboard routes
const dashboardRoutes = require('./dashboard/index.js');
app.use('/api/dashboard', dashboardRoutes);

// Job routes
const jobRoutes = require('./shared/routes/jobRoutes');
app.use('/api/jobs', jobRoutes);

// Second Salary routes
const secondSalaryRoutes = require('./payroll/routes/secondSalaryRoutes.js');
app.use('/api/second-salary', secondSalaryRoutes);

// Salary updates (employee bulk update template/upload, second-salary template/upload)
const salaryUpdateRoutes = require('./salary-updates/index.js');
app.use('/api/salary-updates', salaryUpdateRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: err.message || 'Something went wrong'
  });
});

// Initialize databases and start server
const startServer = async () => {
  try {
    // Initialize database connections
    await initializeAllDatabases();

    // Check S3 Connection
    await checkS3Connection();

    // Start attendance sync job
    const { startSyncJob } = require('./attendance/services/attendanceSyncJob');
    await startSyncJob();

    // Monthly leave accrual cron (00:10 IST daily – runs EL/CCL leave register entries on payroll cycle end date)
    try {
      const { startMonthlyAccrualCron } = require('./leaves/jobs/monthlyAccrualCron');
      startMonthlyAccrualCron();
    } catch (cronErr) {
      console.warn('⚠️  Monthly accrual cron failed to start:', cronErr.message);
    }

    // Annual CL reset cron (00:15 IST daily – runs reset when today matches configured date, e.g. 26 Dec or 1 Apr)
    try {
      const { startAnnualCLResetCron } = require('./leaves/jobs/annualCLResetCron');
      startAnnualCLResetCron();
    } catch (cronErr) {
      console.warn('⚠️  Annual CL reset cron failed to start:', cronErr.message);
    }

    // Resignation deactivation cron (00:05 IST daily - deactivates employees after LWD)
    try {
      const { startResignationCron } = require('./resignations/jobs/resignationCron');
      startResignationCron();
    } catch (cronErr) {
      console.warn('⚠️  Resignation deactivation cron failed to start:', cronErr.message);
    }

    // Start BullMQ Workers for background job processing
    try {
      const { startWorkers } = require('./shared/jobs/worker');
      startWorkers();
    } catch (workerError) {
      console.warn('⚠️  BullMQ Workers failed to start (Redis may not be available):', workerError.message);
      console.warn('⚠️  Jobs will fall back to synchronous processing');
    }

    // Create HTTP server and initialize Socket.io
    const server = http.createServer(app);

    // Set high timeout for bulk data operations (10 minutes)
    server.timeout = 600 * 1000;
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout = 66 * 1000;

    initSocket(server, allowedOrigins);

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 HRMS Backend- before main merge multi shift git is running now  Server is running on port ${PORT}`);
      console.log(`📍 Server URL: http://localhost:${PORT}`);
      console.log(`📋 API Root: http://localhost:${PORT}/`);
      console.log(`💚 Health Check: http://localhost:${PORT}/health`);
      console.log(`\n📦 Available Endpoints:`);
      console.log(`   - Authentication: /api/auth`);
      console.log(`   - Users: /api/users`);
      console.log(`   - Shifts: /api/shifts`);
      console.log(`   - Departments: /api/departments`);
      console.log(`   - Settings: /api/settings`);
      console.log(`   - Employees: /api/employees`);
      console.log(`   - Employee Applications: /api/employee-applications`);
      console.log(`   - Workspaces: /api/workspaces`);
      console.log(`   - Leaves & OD: /api/leaves`);
      console.log(`   - Loans: /api/loans`);
      console.log(`   - Attendance: /api/attendance`);
      console.log(`   - Overtime: /api/ot`);
      console.log(`   - Permissions: /api/permissions`);
      console.log(`   - Allowances & Deductions: /api/allowances-deductions`);
      console.log(`   - Payroll: /api/payroll`);
      console.log(`   - Pay Register: /api/pay-register`);
      console.log(`   - Bonus: /api/bonus`);
      console.log(`   - Arrears: /api/arrears`);
      console.log(`   - Holidays: /api/holidays`);
      console.log(`   - payabale shifts Multi Shift: /api/multi-shift`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    if (process.env.NODE_ENV !== "test") process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  const { closeMongoDB, closeMSSQL } = require('./config/database');
  await closeMSSQL();
  await closeMongoDB();
  process.exit(0);
});

// Export app for testing
module.exports = app;

// Start the server only if run directly (not required as a module)
if (require.main === module) {
  startServer();
}

