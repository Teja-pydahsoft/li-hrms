const { settlementsForEmployee } = require('../bulkPayrollSettlements');

describe('settlementsForEmployee', () => {
  const emp = '507f1f77bcf86cd799439011';
  const other = '507f191e810c19729de860ea';

  test('filters arrears and deductions by employeeId', () => {
    const r = settlementsForEmployee(
      emp,
      [
        { arrearId: 'a1', amount: 100, employeeId: emp },
        { arrearId: 'a2', amount: 200, employeeId: other },
      ],
      [{ deductionId: 'd1', amount: 50, employeeId: emp }]
    );
    expect(r.arrearsSettlements).toEqual([{ arrearId: 'a1', amount: 100 }]);
    expect(r.deductionSettlements).toEqual([{ deductionId: 'd1', amount: 50 }]);
  });

  test('accepts id instead of arrearId / deductionId', () => {
    const r = settlementsForEmployee(
      emp,
      [{ id: 'a9', amount: 12.5, employeeId: emp }],
      [{ id: 'd9', amount: 3, employeeId: emp }]
    );
    expect(r.arrearsSettlements).toEqual([{ arrearId: 'a9', amount: 12.5 }]);
    expect(r.deductionSettlements).toEqual([{ deductionId: 'd9', amount: 3 }]);
  });

  test('skips rows without employeeId or wrong employee', () => {
    const r = settlementsForEmployee(
      emp,
      [{ arrearId: 'x', amount: 1 }, { arrearId: 'y', amount: 2, employeeId: emp }],
      [{ deductionId: 'z', amount: 3, employeeId: other }]
    );
    expect(r.arrearsSettlements).toEqual([{ arrearId: 'y', amount: 2 }]);
    expect(r.deductionSettlements).toEqual([]);
  });

  test('skips items missing arrearId/deductionId', () => {
    const r = settlementsForEmployee(emp, [{ amount: 10, employeeId: emp }], [{ amount: 5, employeeId: emp }]);
    expect(r.arrearsSettlements).toEqual([]);
    expect(r.deductionSettlements).toEqual([]);
  });

  test('treats non-array bulk inputs as empty', () => {
    const r = settlementsForEmployee(emp, null, undefined);
    expect(r.arrearsSettlements).toEqual([]);
    expect(r.deductionSettlements).toEqual([]);
  });

  test('coerces ObjectId-like employeeId strings consistently', () => {
    const r = settlementsForEmployee(
      String(emp),
      [{ arrearId: 'a1', amount: 1, employeeId: emp }],
      []
    );
    expect(r.arrearsSettlements).toHaveLength(1);
  });
});
