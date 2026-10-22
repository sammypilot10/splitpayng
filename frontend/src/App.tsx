import { Routes, Route, Navigate } from 'react-router-dom';
import PaymentCallback from './pages/PaymentCallback';
import { AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import Marketplace from './pages/Marketplace';
import Dashboard from './pages/Dashboard';
import HostDashboard from './pages/HostDashboard';
import CreatePool from './pages/CreatePool';
import MySubscriptions from './pages/MySubscriptions';
import AdminDisputes from './pages/AdminDisputes';
import ProtectedRoute from './components/ProtectedRoute';
import PayoutSetup from './pages/PayoutSetup';
import PaymentMethods from './pages/PaymentMethods';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import VerifyMagicLinkPage from './pages/VerifyMagicLinkPage';

export default function App() {
    return (
        <AuthProvider>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Marketplace />} />
                    <Route path="auth" element={<AuthPage />} />
                    <Route path="login" element={<Navigate to="/auth" replace />} />
                    <Route path="reset-password" element={<ResetPasswordPage />} />
                    <Route path="verify-email" element={<VerifyEmailPage />} />
                    <Route path="auth/verify-magic-link" element={<VerifyMagicLinkPage />} />
                    <Route path="payment/callback" element={<PaymentCallback />} />
                    <Route path="dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="host-dashboard" element={<ProtectedRoute><HostDashboard /></ProtectedRoute>} />
                    <Route path="create-pool" element={<ProtectedRoute><CreatePool /></ProtectedRoute>} />
                    <Route path="my-subscriptions" element={<ProtectedRoute><MySubscriptions /></ProtectedRoute>} />
                    <Route path="payment-methods" element={<ProtectedRoute><PaymentMethods /></ProtectedRoute>} />
                    <Route path="admin/disputes" element={<ProtectedRoute requireAdmin><AdminDisputes /></ProtectedRoute>} />
                    <Route path="payout-setup" element={<ProtectedRoute><PayoutSetup /></ProtectedRoute>} />
                </Route>
            </Routes>
        </AuthProvider>
    );
}