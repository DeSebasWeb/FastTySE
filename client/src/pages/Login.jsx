import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import styles from './Login.module.css';

export default function Login() {
  const { login } = useAuth();
  const [cedula, setCedula] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(cedula, contrasena);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.logo}>FastTyse</h1>
        <p className={styles.subtitle}>Iniciar sesion</p>

        <label className={styles.label}>
          Cedula / Usuario
          <input
            type="text"
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
            className={styles.input}
            autoFocus
          />
        </label>

        <label className={styles.label}>
          Contrasena
          <input
            type="password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            className={styles.input}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.btn} disabled={loading}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
