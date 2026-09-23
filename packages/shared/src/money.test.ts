import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoneyToCents } from './money';
import { addMonths, periodRange } from './period';
import { hasPermission } from './roles';

describe('parseMoneyToCents', () => {
  it.each([
    ["1'850.00", 185000],
    ['1’850.00', 185000],
    ['1850', 185000],
    ['1.850,00', 185000],
    ['1,850.00', 185000],
    ['-1\'450.50', -145050],
    ['1850.-', 185000],
    ['CHF 2 100.00', 210000],
    ['1.850', 185000],
    ['12,5', 1250],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });
});

describe('formatMoney', () => {
  it('formats swiss style', () => {
    expect(formatMoney(185000)).toBe("CHF 1'850.–");
    expect(formatMoney(2540050)).toBe("CHF 25'400.50");
  });
});

describe('periods', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(periodRange('2026-10', '2027-01')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });
});

describe('roles', () => {
  it('caretaker has no finance permissions', () => {
    expect(hasPermission('CARETAKER', 'finance:read')).toBe(false);
    expect(hasPermission('CARETAKER', 'damage:read')).toBe(true);
    expect(hasPermission('TENANT', 'property:read')).toBe(false);
  });
});
