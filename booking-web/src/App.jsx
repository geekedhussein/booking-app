import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireManager, RequireProvider } from './auth/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { PageLoader } from './components/Feedback.jsx';
import { DirectoryPage } from './pages/ResourcesPage.jsx';
import { ProviderPage } from './pages/ProviderPage.jsx';
import { ResourceDetailPage } from './pages/ResourceDetailPage.jsx';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AuthPages.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

// Code-split pages most visitors never open, so customers don't download them.
const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const MyBookingsPage = named(() => import('./pages/MyBookingsPage.jsx'), 'MyBookingsPage');
const AccountPage = named(() => import('./pages/AccountPage.jsx'), 'AccountPage');
const ManageResourcesPage = named(() => import('./pages/manage/ManageResourcesPage.jsx'), 'ManageResourcesPage');
const ResourceEditorPage = named(() => import('./pages/manage/ResourceEditorPage.jsx'), 'ResourceEditorPage');
const StaffSchedulePage = named(() => import('./pages/manage/StaffSchedulePage.jsx'), 'StaffSchedulePage');
const DashboardPage = named(() => import('./pages/manage/DashboardPage.jsx'), 'DashboardPage');

const authed = (el) => <RequireAuth>{el}</RequireAuth>;
// Management screens: providers (their own calendars) and staff (all).
const manager = (el) => (
  <RequireAuth>
    <RequireManager>{el}</RequireManager>
  </RequireAuth>
);
const provider = (el) => (
  <RequireAuth>
    <RequireProvider>{el}</RequireProvider>
  </RequireAuth>
);

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DirectoryPage />} />
          <Route path="p/:slug" element={<ProviderPage />} />
          <Route path="resources/:id" element={<ResourceDetailPage />} />

          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="verify-email" element={<VerifyEmailPage />} />

          <Route path="bookings" element={authed(<MyBookingsPage />)} />
          <Route path="account" element={authed(<AccountPage />)} />

          <Route path="dashboard" element={provider(<DashboardPage />)} />
          <Route path="manage" element={manager(<ManageResourcesPage />)} />
          <Route path="manage/resources/new" element={manager(<ResourceEditorPage />)} />
          <Route path="manage/resources/:id" element={manager(<ResourceEditorPage />)} />
          <Route path="manage/schedule" element={manager(<StaffSchedulePage />)} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
