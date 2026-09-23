import { CHARGE_STATUS, DAMAGE_STATUS, IMPORT_ROW_STATUS, LEASE_STATUS, PAYMENT_STATUS, PRIORITIES, TASK_STATUS } from '@immo/shared';
import { Badge, type Tone } from './ui';

const chargeTone: Record<string, Tone> = { PAID: 'green', OVERPAID: 'purple', PARTIAL: 'yellow', OPEN: 'gray', OVERDUE: 'red', CANCELLED: 'gray' };
const paymentTone: Record<string, Tone> = { ASSIGNED: 'green', PARTIAL: 'yellow', OVERPAID: 'purple', UNCLEAR: 'red', REVIEW: 'yellow', REVERSED: 'gray' };
const importTone: Record<string, Tone> = { READY: 'green', NEEDS_REVIEW: 'yellow', UNMATCHED: 'red', DUPLICATE: 'gray', IGNORED: 'gray', POSTED: 'blue' };
const damageTone: Record<string, Tone> = { NEW: 'blue', ACKNOWLEDGED: 'purple', IN_PROGRESS: 'yellow', WAITING: 'gray', RESOLVED: 'green', CLOSED: 'green', REJECTED: 'gray' };
const prioTone: Record<string, Tone> = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'yellow', URGENT: 'red' };
const leaseTone: Record<string, Tone> = { DRAFT: 'gray', ACTIVE: 'green', TERMINATED: 'yellow', ENDED: 'gray' };
const taskTone: Record<string, Tone> = { OPEN: 'blue', IN_PROGRESS: 'yellow', DONE: 'green', CANCELLED: 'gray' };

export const ChargeBadge = ({ status }: { status: string }) => <Badge tone={chargeTone[status]}>{CHARGE_STATUS[status as keyof typeof CHARGE_STATUS] ?? status}</Badge>;
export const PaymentBadge = ({ status }: { status: string }) => <Badge tone={paymentTone[status]}>{PAYMENT_STATUS[status as keyof typeof PAYMENT_STATUS] ?? status}</Badge>;
export const ImportBadge = ({ status }: { status: string }) => <Badge tone={importTone[status]}>{IMPORT_ROW_STATUS[status as keyof typeof IMPORT_ROW_STATUS] ?? status}</Badge>;
export const DamageBadge = ({ status }: { status: string }) => <Badge tone={damageTone[status]}>{DAMAGE_STATUS[status as keyof typeof DAMAGE_STATUS] ?? status}</Badge>;
export const PriorityBadge = ({ priority }: { priority: string }) => <Badge tone={prioTone[priority]}>{PRIORITIES[priority as keyof typeof PRIORITIES] ?? priority}</Badge>;
export const LeaseBadge = ({ status }: { status: string }) => <Badge tone={leaseTone[status]}>{LEASE_STATUS[status as keyof typeof LEASE_STATUS] ?? status}</Badge>;
export const TaskBadge = ({ status }: { status: string }) => <Badge tone={taskTone[status]}>{TASK_STATUS[status as keyof typeof TASK_STATUS] ?? status}</Badge>;
