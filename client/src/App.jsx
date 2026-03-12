import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Home from './pages/Home.jsx';
import Assign from './pages/Assign.jsx';
import MyAssignments from './pages/MyAssignments.jsx';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user) return <Login />;

  const isAdmin = user.rol === 'Administrador';

  return (
    <Routes>
      {isAdmin ? (
        <>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Home />} />
          <Route path="/assign" element={<Assign />} />
          <Route path="/assignments" element={<MyAssignments />} />
          <Route path="*" element={<Navigate to="/" />} />
        </>
      ) : (
        <>
          <Route path="/assignments" element={<MyAssignments />} />
          <Route path="*" element={<Navigate to="/assignments" />} />
        </>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
