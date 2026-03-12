'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import {
    CheckCircle,
    XCircle,
    User,
    Clock,
    ArrowRight,
    Filter,
    Search,
    ChevronDown,
    AlertCircle,
    Check,
    X as CloseIcon,
    RefreshCw
} from 'lucide-react';

interface UpdateRequest {
    _id: string;
    employeeId: {
        _id: string;
        employee_name: string;
        profilePhoto?: string;
        emp_no: string;
        department?: { name: string };
        designation?: { name: string };
    };
    emp_no: string;
    requestedChanges: Record<string, any>;
    status: 'pending' | 'approved' | 'rejected';
    createdBy: { name: string };
    comments?: string;
    createdAt: string;
}

const UpdateRequestsPage = () => {
    const { user, loading: authLoading } = useAuth();
    const { isHR, isSubAdmin, isSuperAdmin } = useRoleAccess();

    const [requests, setRequests] = useState<UpdateRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('pending');
    const [selectedRequest, setSelectedRequest] = useState<UpdateRequest | null>(null);
    const [rejectComments, setRejectComments] = useState('');
    const [processing, setProcessing] = useState(false);
    const [formGroups, setFormGroups] = useState<any[]>([]);

    const fetchRequests = async () => {
        try {
            setLoading(true);
            const res = await api.getEmployeeUpdateRequests({ status: statusFilter !== 'all' ? statusFilter : undefined });
            if (res.success) {
                setRequests(res.data || []);
            }
        } catch (err) {
            toast.error('Failed to fetch update requests');
        } finally {
            setLoading(false);
        }
    };

    const fetchFormSettings = async () => {
        try {
            const res = await api.getFormSettings();
            if (res.success) {
                setFormGroups(res.data.groups);
            }
        } catch (err) {
            console.error('Failed to fetch form settings');
        }
    };

    useEffect(() => {
        if (!authLoading && (isHR || isSubAdmin || isSuperAdmin)) {
            fetchRequests();
            fetchFormSettings();
        }
    }, [statusFilter, authLoading, isHR, isSubAdmin, isSuperAdmin]);

    const handleApprove = async (id: string) => {
        if (!confirm('Are you sure you want to approve these changes? The employee profile will be updated immediately.')) return;

        try {
            setProcessing(true);
            const res = await api.approveEmployeeUpdateRequest(id);
            if (res.success) {
                toast.success('Request approved successfully');
                setSelectedRequest(null);
                fetchRequests();
            } else {
                toast.error(res.message || 'Failed to approve request');
            }
        } catch (err) {
            toast.error('An error occurred');
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = async (id: string) => {
        if (!rejectComments.trim()) {
            toast.error('Please provide a reason for rejection');
            return;
        }

        try {
            setProcessing(true);
            const res = await api.rejectEmployeeUpdateRequest(id, rejectComments);
            if (res.success) {
                toast.success('Request rejected');
                setSelectedRequest(null);
                setRejectComments('');
                fetchRequests();
            } else {
                toast.error(res.message || 'Failed to reject request');
            }
        } catch (err) {
            toast.error('An error occurred');
        } finally {
            setProcessing(false);
        }
    };

    const getFieldLabel = (fieldId: string) => {
        if (fieldId === 'qualifications') return 'Qualifications';

        for (const group of formGroups) {
            const field = group.fields.find((f: any) => f.id === fieldId);
            if (field) return field.label;
        }
        return fieldId;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (authLoading) return <div className="flex items-center justify-center h-screen"><Spinner /></div>;

    if (!isHR && !isSubAdmin && !isSuperAdmin) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-500">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 4h.01M5.93 5.43L7.35 6.85m12.72 12.72l-1.42-1.42M9 9l1.41-1.41M15 15l1.41-1.41M12 7h.01M12 11h.01m-4.24 6.36l-1.42-1.42m12.72-12.72l1.42 1.42" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Access Denied</h1>
                <p className="text-slate-500 max-w-md">You are not authorized to access this page. This section is restricted to HR and administrative personnel.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-10">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Employee Profile Updates</h1>
                        <p className="text-slate-500 mt-2 font-medium">Review and approve changes requested by employees to their profile records.</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm flex">
                            {['pending', 'approved', 'rejected', 'all'].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    className={`px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${statusFilter === status
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                                        }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => fetchRequests()}
                            className="p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors shadow-sm"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-200 shadow-sm">
                        <Spinner />
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-4">Loading Requests...</p>
                    </div>
                ) : requests.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center bg-white rounded-3xl border border-dashed border-slate-200 shadow-sm text-center px-6">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                            <Clock className="w-8 h-8 text-slate-200" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">No requests found</h3>
                        <p className="text-slate-400 text-sm mt-1">There are no profile update requests matching your current filter.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {requests.map((request) => (
                            <div
                                key={request._id}
                                onClick={() => setSelectedRequest(request)}
                                className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all p-6 cursor-pointer group flex flex-col"
                            >
                                <div className="flex items-start justify-between mb-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100 ring-4 ring-slate-50/50">
                                            {request.employeeId?.profilePhoto ? (
                                                <img src={request.employeeId.profilePhoto} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <User className="w-6 h-6 text-slate-300" />
                                            )}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-900 line-clamp-1">{request.employeeId?.employee_name || 'Unknown Employee'}</h4>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{request.emp_no}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${request.status === 'pending' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                        request.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                            'bg-red-50 text-red-600 border-red-100'
                                        }`}>
                                        {request.status}
                                    </span>
                                </div>

                                <div className="flex-1 space-y-4">
                                    <div>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Requested Changes</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {Object.keys(request.requestedChanges).map(key => (
                                                <span key={key} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-md text-[10px] font-bold border border-indigo-100">
                                                    {getFieldLabel(key)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {request.comments && (
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 italic text-xs text-slate-500">
                                            &ldquo;{request.comments}&rdquo;
                                        </div>
                                    )}
                                </div>

                                <div className="mt-6 pt-6 border-t border-slate-50 flex items-center justify-between text-slate-400">
                                    <div className="flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-tight">{formatDate(request.createdAt)}</span>
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-600 transform group-hover:translate-x-1 transition-all" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Comparison Modal / Slider */}
            {selectedRequest && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col ring-1 ring-slate-900/5">
                        <div className="px-10 py-8 border-b border-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100 ring-4 ring-slate-50/50">
                                    {selectedRequest.employeeId?.profilePhoto ? (
                                        <img src={selectedRequest.employeeId.profilePhoto} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <User className="w-7 h-7 text-slate-300" />
                                    )}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-900">{selectedRequest.employeeId?.employee_name}</h2>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        {selectedRequest.emp_no}
                                        <span className="w-1 h-1 rounded-full bg-slate-200" />
                                        {selectedRequest.employeeId?.department?.name}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setSelectedRequest(null);
                                    setRejectComments('');
                                }}
                                className="p-3 hover:bg-slate-50 rounded-2xl text-slate-400 hover:text-slate-600 transition-all border border-transparent hover:border-slate-100"
                            >
                                <CloseIcon className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-10 space-y-10">
                            {selectedRequest.comments && (
                                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm text-indigo-600">
                                        <AlertCircle className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-1">Employee Comment</h4>
                                        <p className="text-sm text-indigo-700 italic leading-relaxed">{selectedRequest.comments}</p>
                                    </div>
                                </div>
                            )}

                            <div>
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 px-2">Proposed Changes</h3>
                                <div className="grid grid-cols-1 gap-4">
                                    {Object.entries(selectedRequest.requestedChanges).map(([key, value]) => (
                                        <div key={key} className="bg-slate-50 rounded-2xl border border-slate-100 p-6 flex flex-col md:flex-row md:items-center gap-6 group hover:bg-white hover:border-indigo-100 transition-all">
                                            <div className="md:w-1/3">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{getFieldLabel(key)}</p>
                                                <p className="text-xs font-bold text-slate-400">Current Value: <span className="text-slate-500 italic">
                                                    {(() => {
                                                        const current = (selectedRequest.employeeId as any)?.[key] || (selectedRequest.employeeId as any)?.dynamicFields?.[key];
                                                        return typeof current === 'object' ? JSON.stringify(current) : String(current || 'Empty');
                                                    })()}
                                                </span></p>
                                            </div>
                                            <div className="flex-1 flex items-center gap-4">
                                                <div className="hidden md:flex flex-shrink-0 w-8 h-8 rounded-full bg-white border border-slate-100 items-center justify-center text-slate-300">
                                                    <ArrowRight className="w-4 h-4" />
                                                </div>
                                                <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                                                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Requested Value</p>
                                                    <p className="text-sm font-bold text-emerald-900">
                                                        {typeof value === 'object' ? JSON.stringify(value) : String(value || 'Empty')}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {selectedRequest.status === 'pending' && (
                                <div className="pt-10 border-t border-slate-50">
                                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 block px-2">Action Comments</label>
                                    <textarea
                                        value={rejectComments}
                                        onChange={(e) => setRejectComments(e.target.value)}
                                        className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-sm text-slate-900 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all min-h-[120px]"
                                        placeholder="Add comments for approval or reason for rejection..."
                                    />
                                </div>
                            )}
                        </div>

                        <div className="px-10 py-8 bg-slate-50/50 border-t border-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                                Status: <span className="text-slate-900">{selectedRequest.status}</span>
                            </span>

                            {selectedRequest.status === 'pending' ? (
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    <button
                                        onClick={() => handleReject(selectedRequest._id)}
                                        disabled={processing}
                                        className="flex-1 sm:flex-none px-8 py-3.5 bg-white text-red-600 border border-red-100 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-50 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Reject Request
                                    </button>
                                    <button
                                        onClick={() => handleApprove(selectedRequest._id)}
                                        disabled={processing}
                                        className="flex-1 sm:flex-none px-10 py-3.5 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Approve & Update
                                    </button>
                                </div>
                            ) : (
                                <div className="text-sm font-bold text-slate-400 bg-white px-6 py-2 rounded-xl border border-slate-100">
                                    This request has been processed.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UpdateRequestsPage;
