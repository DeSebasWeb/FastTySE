import styles from './ThemeToggle.module.css';

export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button className={styles.toggle} onClick={onToggle} title="Toggle theme">
      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
    </button>
  );
}
