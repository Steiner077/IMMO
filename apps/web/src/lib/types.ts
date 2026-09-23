export interface TenantRef { id: string; firstName: string | null; lastName: string | null; companyName: string | null }
export interface PropertyRef { id: string; name: string }
export interface UnitRef { id: string; label: string }

export interface Property {
  id: string; name: string; street: string; zip: string; city: string; type: string; yearBuilt: number | null;
  unitCount: number; occupiedCount: number; openDamages: number;
  monthlyRentCents?: number; currentDueCents?: number; currentPaidCents?: number;
}

export interface Lease {
  id: string; status: string; startDate: string; endDate: string | null; chargesFrom: string | null; netRentCents: number; utilitiesCents: number;
  depositCents: number; dueDay: number; noticePeriodMonths: number; paymentReference: string | null; notes: string | null;
  tenant: TenantRef & { email?: string | null; phone?: string | null }; unit: UnitRef & { property: PropertyRef & Record<string, unknown> };
  tenantId: string; unitId: string;
}

export interface Charge {
  id: string; period: string; dueDate: string; amountCents: number; paidCents: number; status: string; note: string | null;
  assignments?: { amountCents: number; payment: { id: string; number: number; bookingDate: string; reversedAt: string | null } }[];
}

export interface Payment {
  id: string; number: number; bookingDate: string; amountCents: number; expectedCents: number | null; status: string; source: string; method: string;
  payerName: string | null; payerIban: string | null; reference: string | null; rawText: string | null; confidence: number | null; reversedAt: string | null;
  reversalReason: string | null; note: string | null; leaseId: string | null;
  tenant: TenantRef | null; property: PropertyRef | null; unit: UnitRef | null;
  assignments: { id?: string; amountCents: number; automatic?: boolean; rentCharge: { id?: string; period: string } }[];
}

export interface Doc {
  id: string; name: string; mimeType: string; sizeBytes: number; category: string; classificationScore: number | null; description: string | null;
  visibleToTenant: boolean; createdAt: string; property?: PropertyRef | null; unit?: UnitRef | null; tenant?: TenantRef | null;
  uploadedBy?: { firstName: string; lastName: string } | null;
}

export interface Damage {
  id: string; ticketNumber: number; title: string; description: string; category: string; priority: string; status: string; createdAt: string;
  updatedAt: string; resolvedAt: string | null; preferredAppointment: string | null; location: string | null; estimatedCostCents: number | null;
  property: PropertyRef; unit: UnitRef | null; tenant: TenantRef | null;
  assignedCaretaker: { id: string; firstName: string; lastName: string } | null; serviceProvider: { id: string; name: string } | null;
  _count?: { documents: number };
}

export interface UserLite { id: string; firstName: string; lastName: string; role: string }
