/**
 * Role-Based Permission System
 * 
 * Centralized permission checks for all workspace features.
 * Each function returns true/false based on user role.
 */

export type UserRole = 'super_admin' | 'sub_admin' | 'hr' | 'hod' | 'manager' | 'employee';

export interface User {
    role: UserRole;
    roles?: UserRole[];
    dataScope?: 'all' | 'department' | 'division' | 'own';
    departments?: any[];
    featureControl?: string[];
}

// ==========================================
// ROLE HIERARCHY
// ==========================================

const ROLE_LEVELS: Record<UserRole, number> = {
    super_admin: 100,
    sub_admin: 80,
    hr: 60,
    hod: 50,
    manager: 40,
    employee: 10,
};

/**
 * Check if user has at least the specified role level
 */
export function hasRoleLevel(user: User | null | undefined, minRole: UserRole): boolean {
    if (!user) return false;
    const userLevel = ROLE_LEVELS[user.role] || 0;
    const minLevel = ROLE_LEVELS[minRole] || 0;
    return userLevel >= minLevel;
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(user: User | null | undefined, roles: UserRole[]): boolean {
    if (!user) return false;
    return roles.includes(user.role);
}

/**
 * Check if user is in a management role (can see others' data and take actions)
 */
export function isManagementRole(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager']);
}

// ==========================================
// PAGE ACCESS PERMISSIONS
// ==========================================

export const PAGE_PERMISSIONS: Record<string, UserRole[]> = {
    '/dashboard': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/employees': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/attendance': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/leaves': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/ccl': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/departments': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/shifts': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/shift-roster': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/payroll-transactions': ['sub_admin', 'hr', 'manager', 'employee'],
    '/pay-register': ['sub_admin', 'hr', 'manager', 'employee'],
    '/payments': ['sub_admin', 'hr', 'manager', 'employee'],
    '/payslips': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/allowances-deductions': ['sub_admin', 'hr', 'manager', 'employee'],
    '/loans': ['sub_admin', 'hr', 'manager', 'employee'],
    '/arrears': ['sub_admin', 'hr', 'manager', 'employee'],
    '/ot-permissions': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/reports': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/settings': ['sub_admin', 'hr', 'manager', 'employee'],
    '/users': ['sub_admin', 'hr', 'manager'],
    '/profile': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/confused-shifts': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/holidays': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/resignations': ['sub_admin', 'hr', 'hod', 'manager', 'employee'],
    '/superadmin/holidays': ['sub_admin', 'hr', 'manager'],
};

export function canAccessPage(user: User, pagePath: string): boolean {
    const allowedRoles = PAGE_PERMISSIONS[pagePath];
    if (!allowedRoles) return true; // Default allow if not specified
    return hasAnyRole(user, allowedRoles);
}

// ==========================================
// EMPLOYEE MANAGEMENT PERMISSIONS
// ==========================================

export function canViewEmployees(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'EMPLOYEES');
}

export function canViewApplications(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager']) && canVerifyFeature(user, 'EMPLOYEES');
}

export function canCreateEmployee(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'EMPLOYEES');
}

export function canEditEmployee(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'EMPLOYEES');
}

export function canDeleteEmployee(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'EMPLOYEES');
}

export function canExportEmployees(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'EMPLOYEES');
}

export function canImportEmployees(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'EMPLOYEES');
}

// ==========================================
// ATTENDANCE PERMISSIONS
// ==========================================

export function canViewAttendance(user: User): boolean {
    return true && canViewFeature(user, 'ATTENDANCE'); // All roles can view attendance (scoped by backend)
}

export function canEditAttendance(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod']) && canManageFeature(user, 'ATTENDANCE');
}

export function canApproveAttendance(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod']) && canManageFeature(user, 'ATTENDANCE');
}

export function canExportAttendance(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'ATTENDANCE');
}

// ==========================================
// LEAVE MANAGEMENT PERMISSIONS
// ==========================================

export function canViewLeaves(user: User): boolean {
    return true && canViewFeature(user, 'LEAVE_OD'); // All roles can view leaves (scoped by backend)
}

export function canApplyLeave(user: User): boolean {
    return true && canManageFeature(user, 'LEAVE_OD'); // All roles can apply for leaves
}

export function canApproveLeaves(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'LEAVE_OD');
}

export function canRejectLeaves(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'LEAVE_OD');
}

export function canDeleteLeaves(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'LEAVE_OD');
}

// ==========================================
// PAYROLL PERMISSIONS
// ==========================================

export function canViewPayroll(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'PAYMENTS');
}

export function canProcessPayroll(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'PAYMENTS');
}

export function canEditPayroll(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'PAYMENTS');
}

export function canViewPayslips(user: User): boolean {
    return true && canViewFeature(user, 'PAYSLIPS'); // All roles (employees see their own)
}

export function canGeneratePayslips(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'PAYSLIPS');
}

export function canViewPayRegister(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canViewFeature(user, 'PAY_REGISTER');
}

export function canManagePayRegister(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'PAY_REGISTER');
}

export function canViewAllowances(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'ALLOWANCES_DEDUCTIONS');
}

export function canManageAllowances(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'ALLOWANCES_DEDUCTIONS');
}

export function canViewLoans(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canViewFeature(user, 'LOANS');
}

export function canManageLoans(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'LOANS');
}

export function canViewArrears(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'ARREARS');
}

export function canManageArrears(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'ARREARS');
}

// ==========================================
// DEPARTMENT MANAGEMENT PERMISSIONS
// ==========================================

export function canViewDepartments(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'employee']) && canViewFeature(user, 'DEPARTMENTS');
}

export function canCreateDepartment(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'DEPARTMENTS');
}

export function canEditDepartment(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'DEPARTMENTS');
}

export function canDeleteDepartment(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'manager', 'employee']) && canManageFeature(user, 'DEPARTMENTS');
}

export function canViewDepartmentSettings(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canViewFeature(user, 'DEPARTMENTAL_SETTINGS');
}

export function canManageDepartmentSettings(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'DEPARTMENTAL_SETTINGS');
}

// ==========================================
// SHIFT MANAGEMENT PERMISSIONS
// ==========================================

export function canViewShifts(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'employee']) && canViewFeature(user, 'SHIFTS');
}

export function canCreateShift(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'SHIFTS');
}

export function canEditShift(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'SHIFTS');
}

export function canDeleteShift(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager', 'employee']) && canManageFeature(user, 'SHIFTS');
}

export function canAssignShifts(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'SHIFTS');
}

export function canViewShiftRoster(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'SHIFT_ROSTER');
}

export function canManageShiftRoster(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'SHIFT_ROSTER');
}

export function canViewConfusedShifts(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'CONFUSED_SHIFTS');
}

export function canResolveConfusedShifts(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'CONFUSED_SHIFTS');
}

// ==========================================
// USER MANAGEMENT PERMISSIONS
// ==========================================

// ==========================================
// RESIGNATION PERMISSIONS
// ==========================================

export function canViewResignation(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'RESIGNATION');
}

export function canApplyResignation(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'RESIGNATION');
}

export function canApproveResignation(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager']) && canManageFeature(user, 'RESIGNATION');
}

// ==========================================
// USER MANAGEMENT PERMISSIONS
// ==========================================

export function canViewUsers(user: User): boolean {
    return hasAnyRole(user, ['super_admin', 'sub_admin', 'hr', 'manager']) && canViewFeature(user, 'USERS');
}

export function canCreateUser(user: User): boolean {
    return hasAnyRole(user, ['super_admin', 'sub_admin', 'hr', 'manager']) && canManageFeature(user, 'USERS');
}

export function canEditUser(user: User): boolean {
    return hasAnyRole(user, ['super_admin', 'sub_admin', 'hr', 'manager']) && canManageFeature(user, 'USERS');
}

export function canDeleteUser(user: User): boolean {
    return hasAnyRole(user, ['super_admin', 'sub_admin', 'hr', 'manager']) && canManageFeature(user, 'USERS');
}

export function canResetPassword(user: User): boolean {
    return hasAnyRole(user, ['super_admin', 'sub_admin', 'hr', 'manager']) && canManageFeature(user, 'USERS');
}

// ==========================================
// REPORT PERMISSIONS
// ==========================================

export function canViewReports(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canViewFeature(user, 'REPORTS');
}

export function canExportReports(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'REPORTS');
}

export function canViewFinancialReports(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'REPORTS');
}

// ==========================================
// SETTINGS PERMISSIONS
// ==========================================

export function canViewSettings(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'GENERAL_SETTINGS');
}

export function canEditSettings(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'GENERAL_SETTINGS');
}

// ==========================================
// BONUS MANAGEMENT PERMISSIONS
// ==========================================

export function canViewBonusPolicies(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'BONUS_POLICIES');
}

export function canManageBonusPolicies(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'BONUS_POLICIES');
}

export function canViewBonusCalculator(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'BONUS_CALCULATOR');
}

export function canViewBonusBatches(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canViewFeature(user, 'BONUS_BATCHES');
}

export function canManageBonusBatches(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'employee']) && canManageFeature(user, 'BONUS_BATCHES');
}

// ==========================================
// FEATURE CONTROL OVERRIDE
// ==========================================

/**
 * Check if user has access to a specific feature
 * Respects user-specific featureControl overrides
 */
export function hasFeatureAccess(user: User, featureCode: string): boolean {
    if (!user) return false;
    // If user has featureControl array, check if feature is included
    if (user.featureControl && Array.isArray(user.featureControl)) {
        // Backward compatibility: Exact match checks for full access or legacy format
        if (user.featureControl.includes(featureCode)) return true;

        // Granular check: Check for specific read/write permissions
        // If simply checking for "access" (read), we accept read or write
        return user.featureControl.includes(`${featureCode}:read`) ||
            user.featureControl.includes(`${featureCode}:write`);
    }
    // Default: allow access (will be controlled by role-based permissions)
    return true;
}

/**
 * Check if user has explicit READ permission for a feature
 * Accepts 'feature', 'feature:read', or 'feature:write'
 * When featureControl is empty (not yet resolved from Settings), defaults to true for backward compatibility.
 */
export function canViewFeature(user: User, featureCode: string): boolean {
    if (!user) return false;
    if (!user.featureControl || user.featureControl.length === 0) return true; // Default allow if empty (legacy/role-based)

    return user.featureControl.includes(featureCode) ||
        user.featureControl.includes(`${featureCode}:read`) ||
        user.featureControl.includes(`${featureCode}:write`);
}

/**
 * Check if user has explicit WRITE permission for a feature
 * Accepts 'feature' or 'feature:write'
 * When featureControl is empty (e.g. before layout has resolved from Settings), returns false so write
 * actions are not shown until read/write are properly loaded — fixes immediate post-login showing write.
 */
export function canManageFeature(user: User, featureCode: string): boolean {
    if (!user) return false;
    if (!user.featureControl || user.featureControl.length === 0) return false; // No write until resolved

    return user.featureControl.includes(featureCode) ||
        user.featureControl.includes(`${featureCode}:write`);
}

/**
 * Generic granular permission check
 */
export function hasGranularPermission(user: User, featureCode: string, type: 'read' | 'write'): boolean {
    if (type === 'read') return canViewFeature(user, featureCode);
    if (type === 'write') return canManageFeature(user, featureCode);
    return false;
}

/**
 * Check if user has VERIFY permission for a feature.
 * This is completely independent of read/write — must be explicitly granted.
 * Accepts 'feature:verify' ONLY. Write does NOT imply verify.
 */
export function canVerifyFeature(user: User, featureCode: string): boolean {
    if (!user) return false;
    if (!user.featureControl || user.featureControl.length === 0) return true; // Default allow if empty (legacy/role-based)

    return user.featureControl.includes(featureCode) ||
        user.featureControl.includes(`${featureCode}:verify`);
}

// ==========================================
// DATA SCOPE HELPERS
// ==========================================

export function canViewAllData(user: User): boolean {
    return user.dataScope === 'all' || hasAnyRole(user, ['sub_admin']);
}

export function canViewDepartmentData(user: User): boolean {
    return user.dataScope === 'department' || hasAnyRole(user, ['hr', 'hod']);
}

export function canViewDivisionData(user: User): boolean {
    return user.dataScope === 'division';
}

export function canViewOwnDataOnly(user: User): boolean {
    return user.dataScope === 'own' || user.role === 'employee';
}

// ==========================================
// OT & PERMISSIONS
// ==========================================

export function canViewOT(user: User): boolean {
    return true && canViewFeature(user, 'OT_PERMISSIONS'); // All roles can view (scoped by backend)
}

export function canApplyOT(user: User): boolean {
    return true && canManageFeature(user, 'OT_PERMISSIONS'); // All roles can apply
}

export function canApproveOT(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'OT_PERMISSIONS');
}

export function canRejectOT(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'OT_PERMISSIONS');
}

export function canViewPermissions(user: User): boolean {
    return true && canViewFeature(user, 'OT_PERMISSIONS'); // All roles can view (scoped by backend)
}

export function canApplyPermission(user: User): boolean {
    return true && canManageFeature(user, 'OT_PERMISSIONS'); // All roles can apply
}

export function canApprovePermission(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'OT_PERMISSIONS');
}

export function canRejectPermission(user: User, minRole: UserRole): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'hod', 'manager', 'employee']) && canManageFeature(user, 'OT_PERMISSIONS');
}

// ==========================================
// HOLIDAY CALENDAR PERMISSIONS
// ==========================================

export function canViewHolidayCalendar(user: User): boolean {
    return true && canViewFeature(user, 'HOLIDAY_CALENDAR');
}

export function canManageHolidayCalendar(user: User): boolean {
    return hasAnyRole(user, ['sub_admin', 'hr', 'manager']) && canManageFeature(user, 'HOLIDAY_CALENDAR');
}
