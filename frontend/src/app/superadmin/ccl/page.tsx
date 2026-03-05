'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useMemo } from 'react';
import { api, Department, Division, Designation } from '@/lib/api';
import { auth } from '@/lib/auth';
import Spinner from '@/components/Spinner';
import { PlusIcon, Check, X } from 'lucide-react';
import WorkflowTimeline from '@/components/WorkflowTimeline';
import EmployeeSelect from '@/components/EmployeeSelect';

const StatusBadge = ({ status }: { status: string }) => {
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isApproved ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
        isRejected ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
          'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isApproved ? 'bg-emerald-500' : isRejected ? 'bg-red-500' : 'bg-amber-500'}`} />
      {status}
    </span>
  );
};
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

interface Employee {
  _id: string;
  emp_no: string;
  employee_name: string;
  department?: { _id: string; name: string };
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface CCLRequest {
  _id: string;
  employeeId: Employee;
  emp_no: string;
  date: string;
  isHalfDay: boolean;
  halfDayType?: 'first_half' | 'second_half' | null;
  inTime?: string | null;
  outTime?: string | null;
  totalHours?: number | null;
  attendanceNote?: string | null;
  assignedBy: User;
  purpose: string;
  status: string;
  appliedBy: { name: string; email: string };
  appliedAt: string;
  workflow?: {
    approvalChain: Array<{ stepOrder: number; role: string; label: string; status: string }>;
    nextApproverRole: string;
  };
}

const formatDate = (d: string) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (t: string | Date | null) => {
  if (!t) return '-';
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
};

export default function SuperadminCCLPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [loading, setLoading] = useState(false);
  const [allCCLs, setAllCCLs] = useState<CCLRequest[]>([]);
  const [pendingCCLs, setPendingCCLs] = useState<CCLRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedCCL, setSelectedCCL] = useState<CCLRequest | null>(null);

  const [actionModal, setActionModal] = useState<{ cclId: string; action: 'approve' | 'reject' } | null>(null);
  const [actionComment, setActionComment] = useState('');

  const [filters, setFilters] = useState({ status: '', fromDate: '', toDate: '' });

  // Filter Select states
  const [searchTerm, setSearchTerm] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);

  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState('');
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('');
  const [selectedDesignationFilter, setSelectedDesignationFilter] = useState('');

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    isHalfDay: false,
    halfDayType: null as 'first_half' | 'second_half' | null,
    assignedBy: '',
    purpose: '',
    employeeId: '',
    empNo: '',
  });
  const [assignedByUsers, setAssignedByUsers] = useState<User[]>([]);
  const [employees, setEmployees] = useState<{ _id: string; emp_no: string; employee_name: string }[]>([]);
  const [dateValid, setDateValid] = useState<boolean | null>(null);
  const [dateValidationMessage, setDateValidationMessage] = useState<string>('');
  const [cclWorkflowAllowHigherAuthority, setCclWorkflowAllowHigherAuthority] = useState(false);
  const [cclWorkflowRoleOrder, setCclWorkflowRoleOrder] = useState<string[]>([]);

  const currentUser = auth.getUser();

  const loadData = async () => {
    setLoading(true);
    try {
      const [allRes, pendingRes] = await Promise.all([
        api.getCCLs({
          limit: 500,
          ...(filters.status && { status: filters.status }),
          ...(filters.fromDate && { fromDate: filters.fromDate }),
          ...(filters.toDate && { toDate: filters.toDate }),
        }),
        api.getPendingCCLApprovals(),
      ]);
      if (allRes.success) setAllCCLs(allRes.data || []);
      if (pendingRes.success) setPendingCCLs(pendingRes.data || []);
    } catch (e) {
      toast.error('Failed to load CCL data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'all') loadData(); }, [filters.status, filters.fromDate, filters.toDate]);

  useEffect(() => {
    api.getLeaveSettings('ccl').then((res) => {
      if (res.success && res.data?.workflow) {
        const wf = res.data.workflow as { allowHigherAuthorityToApproveLowerLevels?: boolean; steps?: { stepOrder: number; approverRole: string }[] };
        setCclWorkflowAllowHigherAuthority(Boolean(wf.allowHigherAuthorityToApproveLowerLevels));
        const steps = wf.steps || [];
        const order = steps.slice().sort((a, b) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999)).map(s => String(s.approverRole || '').toLowerCase()).filter(Boolean);
        setCclWorkflowRoleOrder(order);
      }
    }).catch(() => {});
  }, []);

  const loadFilterData = async () => {
    try {
      const [divRes, deptRes, desigRes] = await Promise.all([
        api.getDivisions(),
        api.getDepartments(),
        api.getAllDesignations()
      ]);

      if (divRes.success && divRes.data) setDivisions(divRes.data);
      if (deptRes.success && deptRes.data) setDepartments(deptRes.data as any[]);
      if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
    } catch (err) {
      console.error('Failed to load filter options:', err);
    }
  };

  useEffect(() => {
    loadFilterData();
  }, []);

  // Filtered departments based on selected division
  const filteredDepartments = useMemo(() => {
    if (!selectedDivisionFilter) return departments;
    const div = divisions.find(d => String(d._id) === selectedDivisionFilter);
    if (!div || !div.departments) return departments;
    return departments.filter(dept =>
      (div.departments || []).some(d =>
        (typeof d === 'string' ? d : String((d as any)._id)) === String(dept._id)
      )
    );
  }, [selectedDivisionFilter, divisions, departments]);

  useEffect(() => {
    if (!showForm) return;
    api.getEmployees({ is_active: true }).then((r) => {
      if (r.success && Array.isArray(r.data)) setEmployees(r.data);
    });
  }, [showForm]);

  const resolvedEmpNo = formData.empNo || (formData.employeeId ? undefined : undefined);
  const resolvedEmpId = formData.employeeId;

  useEffect(() => {
    if (!showForm || (!resolvedEmpNo && !resolvedEmpId)) {
      setAssignedByUsers([]);
      return;
    }
    api.getCCLAssignedByUsers({ employeeId: resolvedEmpId || undefined, empNo: resolvedEmpNo || undefined }).then((r) => {
      if (r.success) setAssignedByUsers(r.data || []);
    });
  }, [showForm, resolvedEmpId, resolvedEmpNo, formData.employeeId]);

  useEffect(() => {
    if (!formData.date || (!resolvedEmpNo && !resolvedEmpId)) {
      setDateValid(null);
      setDateValidationMessage('');
      return;
    }
    api
      .validateCCLDate(formData.date, {
        employeeId: resolvedEmpId || undefined,
        empNo: resolvedEmpNo || undefined,
        isHalfDay: formData.isHalfDay,
        halfDayType: formData.halfDayType || undefined,
      })
      .then((r: any) => {
        setDateValid(r.valid);
        setDateValidationMessage(r.message || '');
      })
      .catch(() => { setDateValid(false); setDateValidationMessage('Validation failed'); });
  }, [formData.date, formData.isHalfDay, formData.halfDayType, resolvedEmpId, resolvedEmpNo, formData.employeeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.assignedBy || !formData.purpose.trim() || !formData.employeeId) {
      toast.error('Employee, Assigned By, and Purpose are required');
      return;
    }
    if (dateValid === false) {
      toast.error(dateValidationMessage || 'Selected date is not valid. It must be a holiday/week-off and no existing CCL for that day.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.applyCCL({
        date: formData.date,
        isHalfDay: formData.isHalfDay,
        halfDayType: formData.isHalfDay ? formData.halfDayType || undefined : undefined,
        assignedBy: formData.assignedBy,
        purpose: formData.purpose.trim(),
        employeeId: formData.employeeId,
      });
      if (res.success) {
        setShowForm(false);
        setFormData({
          date: new Date().toISOString().split('T')[0],
          isHalfDay: false,
          halfDayType: null,
          assignedBy: '',
          purpose: '',
          employeeId: '',
          empNo: '',
        });
        toast.success('CCL applied successfully');
        loadData();
      } else {
        toast.error(res.error || 'Failed to submit');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const openActionModal = (id: string, action: 'approve' | 'reject') => {
    setActionModal({ cclId: id, action });
    setActionComment('');
  };

  const handleActionSubmit = async () => {
    if (!actionModal) return;
    setLoading(true);
    try {
      const res = await api.processCCLAction(actionModal.cclId, actionModal.action, actionComment.trim() || undefined);
      if (res.success) {
        setActionModal(null);
        setActionComment('');
        setSelectedCCL(null);
        toast.success(`CCL ${actionModal.action}d successfully`);
        loadData();
      } else toast.error(res.error || 'Action failed');
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const getRoleOrderFromCCL = (ccl: CCLRequest): string[] => {
    const chain = (ccl as any).workflow?.approvalChain;
    if (!chain || !Array.isArray(chain) || chain.length === 0) return [];
    const sorted = chain.slice().sort((a: any, b: any) => (a.stepOrder ?? 999) - (b.stepOrder ?? 999));
    return sorted.map((s: any) => String(s.role || s.stepRole || '').toLowerCase()).filter(Boolean);
  };

  const canPerformAction = (ccl: CCLRequest) => {
    if (!currentUser?.role) return false;
    if (['approved', 'rejected', 'cancelled'].includes(ccl.status)) return false;
    if (['super_admin', 'sub_admin'].includes(currentUser.role)) return true;
    const next = (ccl.workflow?.nextApproverRole || '').toLowerCase().trim();
    if (!next) return false;
    const userRole = String(currentUser.role || '').toLowerCase().trim();
    if (next === userRole || (next === 'final_authority' && userRole === 'hr')) return true;
    if (next === 'reporting_manager') {
      if (['manager', 'hod'].includes(userRole)) return true;
      const reportingManagerIds = (ccl as any).workflow?.reportingManagerIds as string[] | undefined;
      const userId = String((currentUser as any).id ?? (currentUser as any)._id ?? '').trim();
      if (reportingManagerIds?.length && userId && reportingManagerIds.some((id: string) => String(id).trim() === userId)) return true;
    }
    if (cclWorkflowAllowHigherAuthority && cclWorkflowRoleOrder.length > 0) {
      const itemRoleOrder = getRoleOrderFromCCL(ccl);
      const roleOrder = itemRoleOrder.length > 0 ? itemRoleOrder : cclWorkflowRoleOrder;
      const nextIdx = roleOrder.indexOf(next);
      let userIdx = roleOrder.indexOf(userRole);
      if (userIdx === -1 && (userRole === 'hr' || userRole === 'super_admin')) userIdx = roleOrder.length;
      if (userIdx === -1 && userRole === 'manager') {
        const reportingIdx = roleOrder.indexOf('reporting_manager');
        const hrIdx = roleOrder.indexOf('hr');
        userIdx = reportingIdx >= 0 ? reportingIdx : (hrIdx >= 0 ? hrIdx : roleOrder.length);
      }
      if (nextIdx >= 0 && userIdx >= 0 && userIdx >= nextIdx) return true;
    }
    return false;
  };

  const list = activeTab === 'all' ? allCCLs : pendingCCLs;

  return (
    <>
      <ToastContainer position="top-right" autoClose={3000} />
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Time &amp; Attendance</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">CCL (Compensatory Leave)</h1>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" /> Apply CCL
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
          <button
            onClick={() => setActiveTab('all')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${activeTab === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'}`}
          >
            All CCL
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${activeTab === 'pending' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'}`}
          >
            Pending Approvals {pendingCCLs.length > 0 && `(${pendingCCLs.length})`}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'all' && (
            <>
              <select
                value={filters.status}
                onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="">All status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters((p) => ({ ...p, fromDate: e.target.value }))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters((p) => ({ ...p, toDate: e.target.value }))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </>
          )}

          <select
            value={selectedDivisionFilter}
            onChange={(e) => {
              setSelectedDivisionFilter(e.target.value);
              setSelectedDepartmentFilter(''); // Reset department when division changes
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Divisions</option>
            {divisions.map((div) => (
              <option key={div._id} value={div._id}>{div.name}</option>
            ))}
          </select>

          <select
            value={selectedDepartmentFilter}
            onChange={(e) => setSelectedDepartmentFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Departments</option>
            {filteredDepartments.map((dept) => (
              <option key={dept._id} value={dept._id}>{dept.name}</option>
            ))}
          </select>

          <select
            value={selectedDesignationFilter}
            onChange={(e) => setSelectedDesignationFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Designations</option>
            {designations.map((desig) => (
              <option key={desig._id} value={desig._id}>{desig.name}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search employee..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
        {loading && list.length === 0 ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 sm:pl-6">Employee</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Date</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Type</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Assigned By</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Purpose</th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Status</th>
                  <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                {list.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">No CCL requests found</td></tr>
                ) : (
                  list.filter((ccl) => {
                    if (searchTerm) {
                      const searchLower = searchTerm.toLowerCase();
                      const empName = ccl.employeeId?.employee_name || '';
                      const empNo = ccl.emp_no || ccl.employeeId?.emp_no || '';
                      if (!(
                        empName.toLowerCase().includes(searchLower) ||
                        empNo.toLowerCase().includes(searchLower) ||
                        (ccl.purpose && ccl.purpose.toLowerCase().includes(searchLower))
                      )) {
                        return false;
                      }
                    }

                    const emp = ccl.employeeId as any;
                    if (selectedDivisionFilter) {
                      const divId = typeof emp?.division === 'object' ? emp?.division?._id : (emp?.division_id || emp?.division);
                      if (String(divId) !== String(selectedDivisionFilter)) return false;
                    }
                    if (selectedDepartmentFilter) {
                      const deptId = typeof emp?.department === 'object' ? emp?.department?._id : (emp?.department_id || emp?.department);
                      if (String(deptId) !== String(selectedDepartmentFilter)) return false;
                    }
                    if (selectedDesignationFilter) {
                      const desigId = typeof emp?.designation === 'object' ? emp?.designation?._id : (emp?.designation_id || emp?.designation);
                      if (String(desigId) !== String(selectedDesignationFilter)) return false;
                    }

                    return true;
                  }).map((ccl) => (
                    <tr key={ccl._id} className="cursor-pointer transition hover:bg-gray-50 dark:hover:bg-gray-700/50" onClick={() => setSelectedCCL(ccl)}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 sm:pl-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                            {(ccl.employeeId?.employee_name || ccl.emp_no).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{ccl.employeeId?.employee_name || ccl.emp_no}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{ccl.emp_no}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{formatDate(ccl.date)}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{ccl.isHalfDay ? `Half (${ccl.halfDayType || '-'})` : 'Full'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{ccl.assignedBy?.name || '-'}</td>
                      <td className="max-w-[200px] truncate px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{ccl.purpose}</td>
                      <td className="whitespace-nowrap px-3 py-4"><StatusBadge status={ccl.status} /></td>
                      <td className="whitespace-nowrap py-4 pl-3 pr-4 text-right sm:pr-6">
                        {canPerformAction(ccl) && (
                          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => openActionModal(ccl._id, 'approve')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button onClick={() => openActionModal(ccl._id, 'reject')} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Apply Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
            <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Apply CCL (On behalf)</h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Compensatory leave for holiday/week-off work</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Employee *</label>
                <EmployeeSelect
                  value={formData.employeeId}
                  onChange={(emp) => {
                    setFormData((p) => ({ ...p, employeeId: emp?._id || '', empNo: emp?.emp_no || '' }));
                  }}
                  required={true}
                  className="mt-1.5 w-full"
                  placeholder="Select employee"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
                  required
                  className="mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
                {dateValid !== null && (
                  <p className={`mt-1.5 text-xs ${dateValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {dateValidationMessage || (dateValid ? 'Date is a holiday/week-off' : 'Date is not valid')}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full or half day</label>
                <div className="mt-2 flex gap-6">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" checked={!formData.isHalfDay} onChange={() => setFormData((p) => ({ ...p, isHalfDay: false, halfDayType: null }))} className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Full day</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" checked={formData.isHalfDay} onChange={() => setFormData((p) => ({ ...p, isHalfDay: true }))} className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Half day</span>
                  </label>
                </div>
              </div>
              {formData.isHalfDay && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Half (optional)</label>
                  <select value={formData.halfDayType || ''} onChange={(e) => setFormData((p) => ({ ...p, halfDayType: (e.target.value || null) as any }))} className="mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                    <option value="">Select</option>
                    <option value="first_half">First half</option>
                    <option value="second_half">Second half</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Assigned by *</label>
                <select value={formData.assignedBy} onChange={(e) => setFormData((p) => ({ ...p, assignedBy: e.target.value }))} required className="mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option value="">Select user</option>
                  {assignedByUsers.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Purpose / reason *</label>
                <textarea value={formData.purpose} onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value }))} rows={3} required placeholder="What did they do on that day?" className="mt-1.5 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">Cancel</button>
                <button type="submit" disabled={loading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Submitting...' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedCCL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm" onClick={() => setSelectedCCL(null)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                  {(selectedCCL.employeeId?.employee_name || selectedCCL.emp_no).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">CCL Detail</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedCCL.employeeId?.employee_name} ({selectedCCL.emp_no})</p>
                </div>
              </div>
            </div>
            <div className="space-y-4 p-6">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Date</dt><dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{formatDate(selectedCCL.date)}</dd></div>
                <div><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Type</dt><dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{selectedCCL.isHalfDay ? `Half - ${selectedCCL.halfDayType || '-'}` : 'Full'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Assigned by</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{selectedCCL.assignedBy?.name}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Purpose</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{selectedCCL.purpose}</dd></div>
                {selectedCCL.inTime && <div><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">In time</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatTime(selectedCCL.inTime)}</dd></div>}
                {selectedCCL.outTime && <div><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Out time</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{formatTime(selectedCCL.outTime)}</dd></div>}
                {selectedCCL.totalHours != null && <div><dt className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Total hours</dt><dd className="mt-1 text-sm text-gray-900 dark:text-white">{selectedCCL.totalHours}h</dd></div>}
              </dl>
              {selectedCCL.attendanceNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{selectedCCL.attendanceNote}</p>}
              <div className="flex items-center gap-2"><span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</span><StatusBadge status={selectedCCL.status} /></div>
            </div>
            {selectedCCL.workflow?.approvalChain?.length ? <div className="border-t border-gray-200 px-6 py-4 dark:border-gray-700"><WorkflowTimeline workflow={selectedCCL.workflow as any} /></div> : null}
            <div className="flex flex-wrap gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
              {selectedCCL && canPerformAction(selectedCCL) && (
                <>
                  <button onClick={() => { setSelectedCCL(null); openActionModal(selectedCCL._id, 'approve'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Approve</button>
                  <button onClick={() => { setSelectedCCL(null); openActionModal(selectedCCL._id, 'reject'); }} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"><X className="h-4 w-4" /> Reject</button>
                </>
              )}
              <button onClick={() => setSelectedCCL(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Approve/Reject Comment Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm" onClick={() => setActionModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{actionModal.action === 'approve' ? 'Approve CCL' : 'Reject CCL'}</h3>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{actionModal.action === 'approve' ? 'Comments (optional)' : 'Reason (optional)'}</label>
              <textarea value={actionComment} onChange={(e) => setActionComment(e.target.value)} placeholder={actionModal.action === 'approve' ? 'Add a comment...' : 'Add a reason...'} rows={3} autoFocus className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setActionModal(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">Cancel</button>
                <button onClick={handleActionSubmit} disabled={loading} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${actionModal.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>{loading ? 'Processing...' : actionModal.action === 'approve' ? 'Approve' : 'Reject'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
