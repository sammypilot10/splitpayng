import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, allowedRoles, requireAdmin }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0c10]">
        <div className="w-12 h-12 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const rolesToCheck = requireAdmin ? ['ADMIN'] : allowedRoles;

  if (rolesToCheck && !rolesToCheck.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}