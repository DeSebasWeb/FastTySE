import { NavLink } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { useAuth } from '../hooks/useAuth.jsx';
import styles from './NavBar.module.css';

export default function NavBar() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();

  const isAdmin = user?.rol === 'Administrador';

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <span className={styles.logo}>FastTyse</span>
        <div className={styles.links}>
          {isAdmin && (
            <>
              <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : styles.link}>
                Dashboard
              </NavLink>
              <NavLink to="/upload" className={({ isActive }) => isActive ? styles.active : styles.link}>
                Upload
              </NavLink>
              <NavLink to="/assign" className={({ isActive }) => isActive ? styles.active : styles.link}>
                Asignar
              </NavLink>
            </>
          )}
          <NavLink to="/assignments" className={({ isActive }) => isActive ? styles.active : styles.link}>
            {isAdmin ? 'Asignaciones' : 'Mis Asignaciones'}
          </NavLink>
        </div>
      </div>
      <div className={styles.right}>
        {user && (
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user.nombres} {user.apellidos}</span>
            <span className={styles.userRole}>{user.rol}</span>
          </div>
        )}
        <ThemeToggle theme={theme} onToggle={toggle} />
        {user && (
          <button className={styles.logoutBtn} onClick={logout}>
            Salir
          </button>
        )}
      </div>
    </nav>
  );
}
