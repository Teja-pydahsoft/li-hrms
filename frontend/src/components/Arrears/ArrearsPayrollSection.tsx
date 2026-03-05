import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-toastify';

// Define the API response type for getArrearsForPayroll
interface ArrearsForPayrollResponse {
  success: boolean;
  data: ArrearsForPayroll[];
  count: number;
}

interface ArrearsForPayroll {
  _id: string;
  type?: 'incremental' | 'direct';
  employee: {
    _id: string;
    emp_no: string;
    first_name: string;
    last_name: string;
    department_id: string | { _id: string; name: string };
    division_id?: string | { _id: string; name: string };
  };
  totalAmount: number;
  settledAmount: number;
  isFullySettled: boolean;
  status: string;
  startMonth?: string;
  endMonth?: string;
  reason: string;
  monthlyAmount: number;
  remainingAmount?: number;
}

interface ArrearsPayrollSectionProps {
  month: number;
  year: number;
  divisionId?: string;
  departmentId?: string;
  onArrearsSelected: (arrears: Array<{ id: string; amount: number; employeeId?: string }>) => void;
}

export const ArrearsPayrollSection: React.FC<ArrearsPayrollSectionProps> = ({
  month,
  year,
  divisionId,
  departmentId,
  onArrearsSelected,
}) => {
  const [arrears, setArrears] = useState<ArrearsForPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArrears, setSelectedArrears] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchArrears();
  }, [month, year]);

  const filteredArrears = arrears.filter(arr => {
    const emp = arr.employee as { department_id?: string | { _id: string }; division_id?: string | { _id: string } };
    const empDivId = typeof emp?.division_id === 'object' ? emp?.division_id?._id : emp?.division_id;
    const empDeptId = typeof emp?.department_id === 'object' ? emp?.department_id?._id : emp?.department_id;
    if (divisionId && empDivId !== divisionId) return false;
    if (departmentId && empDeptId !== departmentId) return false;
    return true;
  });

  const fetchArrears = async () => {
    try {
      setLoading(true);

      // Use the API client method
      const response = await api.getArrearsForPayroll({
        month,
        year,
      });

      console.log('[ArrearsPayrollSection] API Response:', response);

      // Extract the data array from the response
      // Backend returns: { success: true, count: X, data: [...] }
      // apiRequest spreads it, so we get: { success: true, count: X, data: [...] }
      // Backend returns: { success: true, count: X, data: [...] }
      const arrearsData = (response?.data && Array.isArray(response.data)) ? response.data : [];
      console.log('[ArrearsPayrollSection] Arrears data:', arrearsData);
      setArrears(arrearsData as ArrearsForPayroll[]);

      // Initialize selected arrears with remaining amount
      const initialSelected: Record<string, number> = {};
      arrearsData.forEach((arr: ArrearsForPayroll) => {
        initialSelected[arr._id] = arr.remainingAmount || (arr.totalAmount - (arr.settledAmount || 0));
      });
      setSelectedArrears(initialSelected);
      // NOTE: We pass ALL arrears initially selected, regardless of department filter
      // Parent component (Page) should decide which ones to use based on the context (Calculate for specific employee)
      onArrearsSelected(
        Object.entries(initialSelected).map(([id, amount]) => {
          const arrear = arrearsData.find((a: ArrearsForPayroll) => a._id === id);
          return {
            id,
            amount,
            employeeId: arrear?.employee._id
          };
        })
      );
    } catch (error) {
      console.error('Error fetching arrears:', error);
      toast.error('Failed to load arrears data');
    } finally {
      setLoading(false);
    }
  };

  const handleAmountChange = (id: string, value: string) => {
    const amount = parseFloat(value) || 0;
    setSelectedArrears(prev => ({
      ...prev,
      [id]: amount
    }));

    // Notify parent component of the updated selection
    const updatedSelection = Object.entries({
      ...selectedArrears,
      [id]: amount
    }).map(([arrId, amt]) => {
      // Find the arrear object to get the employee ID
      const arrear = arrears.find(a => a._id === arrId);
      return {
        id: arrId,
        amount: amt,
        employeeId: arrear?.employee._id // Include employee ID
      };
    });

    // @ts-ignore - Ignore type error during transition
    onArrearsSelected(updatedSelection);
  };

  const toggleArrear = (id: string, isChecked: boolean) => {
    const arrearsItem = arrears.find(arr => arr._id === id);
    if (!arrearsItem) return;

    const remainingAmount = arrearsItem.totalAmount - (arrearsItem.settledAmount || 0);

    setSelectedArrears(prev => {
      const updated = { ...prev };
      if (isChecked) {
        updated[id] = remainingAmount;
      } else {
        delete updated[id];
      }

      // Notify parent component of the updated selection
      const updatedSelection = Object.entries(updated).map(([arrId, amt]) => {
        const arrear = arrears.find(a => a._id === arrId);
        return {
          id: arrId,
          amount: amt,
          employeeId: arrear?.employee._id
        }
      });
      onArrearsSelected(updatedSelection);

      return updated;
    });
  };

  if (loading) {
    return <div className="p-4">Loading arrears data...</div>;
  }

  // Check based on FILTERED list
  if (filteredArrears.length === 0) {
    return <div className="p-4 text-gray-500">No pending arrears found for the selected period{(divisionId || departmentId) ? ' matching the selected filter' : ''}.</div>;
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-4">Arrears for Payroll</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white dark:bg-gray-800 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Include
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Employee
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Period
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Total Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Settled
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Remaining
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Amount to Settle
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredArrears.map((arr) => {
              const remaining = arr.totalAmount - (arr.settledAmount || 0);
              const isSelected = selectedArrears.hasOwnProperty(arr._id);

              return (
                <tr key={arr._id} className={isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleArrear(arr._id, e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {arr.employee.first_name} {arr.employee.last_name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {arr.employee.emp_no}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">
                      {arr.type === 'direct' ? '—' : `${arr.startMonth ? new Date(arr.startMonth).toLocaleDateString() : '—'} - ${arr.endMonth ? new Date(arr.endMonth).toLocaleDateString() : '—'}`}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {arr.reason}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    ₹{arr.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    ₹{(arr.settledAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <span className={remaining > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}>
                      ₹{remaining.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="mr-2">₹</span>
                      <input
                        type="number"
                        min="0"
                        max={remaining}
                        step="0.01"
                        value={isSelected ? (selectedArrears[arr._id] || '') : ''}
                        onChange={(e) => handleAmountChange(arr._id, e.target.value)}
                        disabled={!isSelected}
                        className="w-32 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                      />
                      <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                        / {remaining.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ArrearsPayrollSection;
