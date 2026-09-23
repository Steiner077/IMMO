import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { PropertiesPage, PropertyDetailPage } from './pages/Properties';
import { UnitDetailPage } from './pages/UnitDetail';
import { TenantsPage, TenantDetailPage } from './pages/Tenants';
import { LeasesPage, LeaseDetailPage } from './pages/Leases';
import { PaymentsPage, PaymentDetailPage } from './pages/Payments';
import { ImportsPage, ImportDetailPage } from './pages/Imports';
import { MonthlyClosePage } from './pages/MonthlyClose';
import { DamagesPage, DamageDetailPage } from './pages/Damages';
import { DocumentsPage } from './pages/Documents';
import { MessagesPage } from './pages/Messages';
import { TasksPage } from './pages/Tasks';
import { AppointmentsPage } from './pages/Appointments';
import { FinancePage } from './pages/Finance';
import { ReportsPage } from './pages/Reports';
import { NotificationsPage } from './pages/Notifications';
import { AutomationPage } from './pages/Automation';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="immobilien" element={<PropertiesPage />} />
        <Route path="immobilien/:id" element={<PropertyDetailPage />} />
        <Route path="objekte/:id" element={<UnitDetailPage />} />
        <Route path="mieter" element={<TenantsPage />} />
        <Route path="mieter/:id" element={<TenantDetailPage />} />
        <Route path="mietvertraege" element={<LeasesPage />} />
        <Route path="mietvertraege/:id" element={<LeaseDetailPage />} />
        <Route path="zahlungen" element={<PaymentsPage />} />
        <Route path="zahlungen/import" element={<ImportsPage />} />
        <Route path="zahlungen/import/:id" element={<ImportDetailPage />} />
        <Route path="zahlungen/:id" element={<PaymentDetailPage />} />
        <Route path="monatsabschluss" element={<MonthlyClosePage />} />
        <Route path="monatsabschluss/:period" element={<MonthlyClosePage />} />
        <Route path="maengel" element={<DamagesPage />} />
        <Route path="maengel/:id" element={<DamageDetailPage />} />
        <Route path="dokumente" element={<DocumentsPage />} />
        <Route path="nachrichten" element={<MessagesPage />} />
        <Route path="nachrichten/:id" element={<MessagesPage />} />
        <Route path="aufgaben" element={<TasksPage />} />
        <Route path="termine" element={<AppointmentsPage />} />
        <Route path="finanzen" element={<FinancePage />} />
        <Route path="berichte" element={<ReportsPage />} />
        <Route path="benachrichtigungen" element={<NotificationsPage />} />
        <Route path="automatisierung" element={<AutomationPage />} />
        <Route path="protokoll" element={<AuditPage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
