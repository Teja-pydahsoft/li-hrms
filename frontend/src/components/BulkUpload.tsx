'use client';

import { useState, useRef, useEffect } from 'react';
import { parseFile, downloadTemplate, ParsedRow } from '@/lib/bulkUpload';

interface BulkUploadProps {
  title: string;
  templateHeaders: string[];
  templateSample: ParsedRow[];
  templateFilename: string;
  /** Optional info message shown at top of content (e.g. "Employee numbers will be auto-generated") */
  infoMessage?: string;
  /** When true, show a toggle in the preview step: "Ignore employee numbers from file (auto-generate)" */
  showAutoGenerateEmpNoToggle?: boolean;
  autoGenerateEmpNo?: boolean;
  onAutoGenerateEmpNoChange?: (value: boolean) => void;
  columns: {
    key: string;
    label: string;
    editable?: boolean;
    type?: 'text' | 'number' | 'date' | 'select';
    options?: { value: string; label: string }[] | ((row: ParsedRow) => { value: string; label: string }[]);
    width?: string;
  }[];
  validateRow?: (row: ParsedRow, index: number, allData: ParsedRow[]) => { isValid: boolean; errors: string[]; fieldErrors?: { [key: string]: string }; mappedRow?: ParsedRow };
  onSubmit: (data: ParsedRow[]) => Promise<{ success: boolean; message?: string; failedRows?: Array<{ emp_no: string; message: string }> }>;
  onClose: () => void;
}

export default function BulkUpload({
  title,
  templateHeaders,
  templateSample,
  templateFilename,
  infoMessage,
  showAutoGenerateEmpNoToggle = false,
  autoGenerateEmpNo = false,
  onAutoGenerateEmpNoChange,
  columns,
  validateRow,
  onSubmit,
  onClose,
}: BulkUploadProps) {
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [data, setData] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<{ [key: number]: { rowErrors: string[]; fieldErrors: { [key: string]: string } } }>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentErrorIndex, setCurrentErrorIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<ParsedRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  dataRef.current = data;

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0 };
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft = dragStartRef.current.scrollLeft + dragStartRef.current.x - e.clientX;
    };
    const onMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);

  // Re-validate all rows when "ignore employee numbers" toggle changes (preview step)
  useEffect(() => {
    if (!showAutoGenerateEmpNoToggle || step !== 'preview' || !validateRow) return;
    const currentData = dataRef.current;
    if (currentData.length === 0) return;
    const newErrors: { [key: number]: { rowErrors: string[]; fieldErrors: { [key: string]: string } } } = {};
    const processedData = currentData.map((row, index) => {
      const validation = validateRow(row, index, currentData);
      if (!validation.isValid) {
        newErrors[index] = {
          rowErrors: validation.errors,
          fieldErrors: validation.fieldErrors || {}
        };
      }
      return validation.mappedRow ? validation.mappedRow : row;
    });
    setErrors(newErrors);
    setData(processedData);
  }, [step, showAutoGenerateEmpNoToggle, autoGenerateEmpNo]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage(null);

    const result = await parseFile(file);

    if (!result.success) {
      setMessage({ type: 'error', text: result.errors.join(', ') });
      setLoading(false);
      return;
    }

    // Validate each row if validator provided
    const rowErrors: { [key: number]: { rowErrors: string[]; fieldErrors: { [key: string]: string } } } = {};
    const processedData = result.data.map((row, index) => {
      let finalRow = row;
      if (validateRow) {
        const validation = validateRow(row, index, result.data);
        if (!validation.isValid) {
          rowErrors[index] = {
            rowErrors: validation.errors,
            fieldErrors: validation.fieldErrors || {}
          };
        }
        if (validation.mappedRow) {
          finalRow = validation.mappedRow;
        }
      }
      return finalRow;
    });

    setData(processedData);
    setErrors(rowErrors);
    setStep('preview');
    setLoading(false);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadTemplate = () => {
    downloadTemplate(templateHeaders, templateSample, templateFilename);
  };

  const handleCellChange = (rowIndex: number, key: string, value: string | number | null) => {
    setData((prev) => {
      const newData = [...prev];
      newData[rowIndex] = { ...newData[rowIndex], [key]: value };
      return newData;
    });

    // Re-validate the row
    if (validateRow) {
      const validation = validateRow({ ...data[rowIndex], [key]: value }, rowIndex, data);

      // Update the row with mappedRow if provided (useful for normalization)
      if (validation.mappedRow) {
        setData((prev) => {
          const newData = [...prev];
          newData[rowIndex] = validation.mappedRow!;
          return newData;
        });
      }

      setErrors((prev) => {
        const newErrors = { ...prev };
        if (validation.isValid) {
          delete newErrors[rowIndex];
        } else {
          newErrors[rowIndex] = {
            rowErrors: validation.errors,
            fieldErrors: validation.fieldErrors || {}
          };
        }
        return newErrors;
      });
    }
  };

  const handleRemoveRow = (rowIndex: number) => {
    setData((prev) => prev.filter((_, i) => i !== rowIndex));
    setErrors((prev) => {
      const newErrors: { [key: number]: { rowErrors: string[]; fieldErrors: { [key: string]: string } } } = {};
      Object.keys(prev).forEach((key) => {
        const idx = parseInt(key);
        if (idx < rowIndex) {
          newErrors[idx] = prev[idx];
        } else if (idx > rowIndex) {
          newErrors[idx - 1] = prev[idx];
        }
      });
      return newErrors;
    });
  };

  const handleSubmit = async () => {
    if (Object.keys(errors).length > 0) {
      setMessage({ type: 'error', text: 'Please fix all errors before submitting' });
      return;
    }

    if (data.length === 0) {
      setMessage({ type: 'error', text: 'No data to submit' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const result = await onSubmit(data);
      if (result.success) {
        setMessage({ type: 'success', text: result.message || 'Data uploaded successfully!' });
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setMessage({ type: 'error', text: result.message || 'Failed to upload data' });

        // Handle server-side row errors
        if (result.failedRows && result.failedRows.length > 0) {
          const failedData: ParsedRow[] = [];
          const newErrors: { [key: number]: { rowErrors: string[]; fieldErrors: { [key: string]: string } } } = {};

          result.failedRows.forEach((fail, newIdx) => {
            // Find existing row to preserve its other fields
            const existingRow = data.find(row =>
              String(row.emp_no || '').trim().toUpperCase() === String(fail.emp_no || '').trim().toUpperCase()
            );

            if (existingRow) {
              failedData.push(existingRow);
              const rowMsg = fail.message || 'Server-side validation failed';
              const isDuplicate = rowMsg.toLowerCase().includes('already exists');

              newErrors[newIdx] = {
                rowErrors: [rowMsg],
                fieldErrors: {
                  ...(isDuplicate ? { emp_no: 'Duplicate ID' } : {}),
                  emp_no: rowMsg.length > 30 ? 'Server Error' : rowMsg
                }
              };
            }
          });

          if (failedData.length > 0) {
            setData(failedData);
            setErrors(newErrors);
            setCurrentErrorIndex(0);
            setMessage({
              type: 'error',
              text: `${result.message || 'Upload failed'}. ${failedData.length} rows failed and are shown below. Successful rows have been processed.`
            });
          }
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred while uploading' });
    } finally {
      setSubmitting(false);
    }
  };

  const navigateError = (direction: 'next' | 'prev') => {
    const errorIndices = Object.keys(errors).map(Number).sort((a, b) => a - b);
    if (errorIndices.length === 0) return;

    let nextIdx = 0;
    if (direction === 'next') {
      nextIdx = (currentErrorIndex + 1) % errorIndices.length;
    } else {
      nextIdx = (currentErrorIndex - 1 + errorIndices.length) % errorIndices.length;
    }

    setCurrentErrorIndex(nextIdx);
    const rowIdx = errorIndices[nextIdx];
    const element = document.getElementById(`row-${rowIdx}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  const validCount = data.length - Object.keys(errors).length;

  return (
    <div className="fixed inset-0 z-[12000] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[12000] max-h-[95vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/50 px-6 py-4 dark:border-slate-700 dark:from-slate-900 dark:to-blue-900/20">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {step === 'upload' ? 'Upload Excel or CSV file' : `Preview and edit ${data.length} records`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-500 dark:border-slate-700 dark:bg-slate-900"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6" style={{ maxHeight: 'calc(95vh - 180px)' }}>
          {infoMessage && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
              <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {infoMessage}
            </div>
          )}
          {message && (
            <div
              className={`mb-4 rounded-xl border px-4 py-3 text-sm ${message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                }`}
            >
              {message.text}
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-6">
              {/* Download Template */}
              <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 dark:border-blue-800 dark:from-blue-900/20 dark:to-indigo-900/20">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-blue-900 dark:text-blue-300">Download Template</h3>
                    <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                      Use this template to ensure your data is formatted correctly
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadTemplate}
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-blue-700"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Template
                  </button>
                </div>
              </div>

              {/* File Upload */}
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="bulk-file-input"
                />
                <label htmlFor="bulk-file-input" className="cursor-pointer">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                    <svg className="h-8 w-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium text-slate-700 dark:text-slate-300">
                    {loading ? 'Processing...' : 'Click to upload or drag and drop'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Excel (.xlsx, .xls) or CSV files
                  </p>
                </label>
              </div>

              {/* Instructions */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Instructions</h3>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">1</span>
                    Download the template file to see the required format
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">2</span>
                    Fill in your data following the template columns
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">3</span>
                    Upload the file and review the preview
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">4</span>
                    Edit any data in the preview if needed, then submit
                  </li>
                </ul>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              {/* Employee number: use from file vs auto-generate */}
              {showAutoGenerateEmpNoToggle && onAutoGenerateEmpNoChange && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Employee numbers:</span>
                  <label className="flex cursor-pointer items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoGenerateEmpNo}
                      onClick={() => onAutoGenerateEmpNoChange(!autoGenerateEmpNo)}
                      className={`${autoGenerateEmpNo ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
                    >
                      <span className={`${autoGenerateEmpNo ? 'translate-x-5' : 'translate-x-1'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200`} />
                    </button>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {autoGenerateEmpNo ? 'Ignore from file (auto-generate)' : 'Use from file'}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {autoGenerateEmpNo ? 'Employee numbers in the file will be ignored; system will assign new numbers.' : 'Employee number column in the file is required for each row.'}
                  </span>
                </div>
              )}

              {/* Stats */}
              <div className="flex flex-wrap gap-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                  <span className="text-sm text-slate-500 dark:text-slate-400">Total Records:</span>
                  <span className="ml-2 font-semibold text-slate-900 dark:text-slate-100">{data.length}</span>
                </div>
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20">
                  <span className="text-sm text-green-600 dark:text-green-400">Valid:</span>
                  <span className="ml-2 font-semibold text-green-700 dark:text-green-300">{validCount}</span>
                </div>
                {hasErrors && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
                    <span className="text-sm text-red-600 dark:text-red-400">Errors:</span>
                    <span className="ml-2 font-semibold text-red-700 dark:text-red-300">{Object.keys(errors).length}</span>
                  </div>
                )}
              </div>

              {/* Data Table */}
              <div
                ref={scrollRef}
                onMouseDown={onMouseDown}
                className={`overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 hover:scrollbar-thumb-slate-400 dark:hover:scrollbar-thumb-slate-600 transition-all ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                      <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        #
                      </th>
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400"
                          style={{ minWidth: col.width || '120px' }}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        Status
                      </th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {data.map((row, rowIndex) => {
                      const rowErrorObj = errors[rowIndex];
                      const rowErrors = rowErrorObj?.rowErrors || [];
                      const fieldErrors = rowErrorObj?.fieldErrors || {};
                      const hasRowError = rowErrors.length > 0;

                      return (
                        <tr
                          key={rowIndex}
                          id={`row-${rowIndex}`}
                          className={`group border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/40 ${hasRowError ? 'bg-red-50/30' : 'bg-white dark:bg-slate-950'}`}
                        >
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                            {rowIndex + 1}
                          </td>
                          {columns.map((col) => {
                            const resolvedOptions = typeof col.options === 'function' ? col.options(row) : col.options;
                            const cellError = fieldErrors[col.key];

                            return (
                              <td key={col.key} className="px-3 py-2 align-top">
                                {col.editable !== false ? (
                                  <div className="flex flex-col gap-1">
                                    {col.type === 'select' && resolvedOptions ? (
                                      <select
                                        value={(row[col.key] as string) || ''}
                                        onChange={(e) => handleCellChange(rowIndex, col.key, e.target.value)}
                                        className={`w-full rounded-lg border bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 ${cellError
                                          ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                                          : 'border-slate-200 focus:border-blue-400 focus:ring-blue-400 dark:border-slate-700'
                                          } dark:bg-slate-900 dark:text-slate-100`}
                                      >
                                        <option value="">Select...</option>
                                        {resolvedOptions.map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type={col.type || 'text'}
                                        value={(row[col.key] as string) || ''}
                                        onChange={(e) =>
                                          handleCellChange(
                                            rowIndex,
                                            col.key,
                                            col.type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value
                                          )
                                        }
                                        onWheel={(e) => col.type === 'number' && e.currentTarget.blur()}
                                        className={`w-full rounded-lg border bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 ${cellError
                                          ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
                                          : 'border-slate-200 focus:border-blue-400 focus:ring-blue-400 dark:border-slate-700'
                                          } dark:bg-slate-900 dark:text-slate-100 ${col.type === 'number' ? 'no-spinner' : ''}`}
                                      />
                                    )}
                                    {cellError && (
                                      <span className="text-[10px] font-medium text-red-500 animate-in fade-in slide-in-from-top-1">
                                        {cellError}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-700 dark:text-slate-300">
                                    {row[col.key]?.toString() || '-'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2">
                            {hasRowError ? (
                              <div className="group relative">
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                  Error
                                </span>
                                <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-64 rounded-lg border border-red-200 bg-white p-2 text-xs text-red-600 shadow-lg group-hover:block dark:border-red-800 dark:bg-slate-900 dark:text-red-400">
                                  {rowErrors.map((err, i) => (
                                    <div key={i}>• {err}</div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                Valid
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => handleRemoveRow(rowIndex)}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                              title="Remove row"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          {step === 'preview' && (
            <button
              onClick={() => setStep('upload')}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Upload
            </button>
          )}

          {step === 'preview' && hasErrors && (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                {Object.keys(errors).length} errors found
              </span>
              <div className="flex items-center border-l border-slate-200 pl-4 dark:border-slate-700">
                <button
                  onClick={() => navigateError('prev')}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Previous Error"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <span className="text-xs font-semibold tabular-nums text-slate-500">
                  {currentErrorIndex + 1} / {Object.keys(errors).length}
                </span>
                <button
                  onClick={() => navigateError('next')}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="Next Error"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          <div className="ml-auto flex gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              Cancel
            </button>
            {step === 'preview' && (
              <button
                onClick={handleSubmit}
                disabled={submitting || hasErrors || data.length === 0}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-600 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Submit {validCount} Records
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


