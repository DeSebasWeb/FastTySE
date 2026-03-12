import styles from './StatsCards.module.css';

function fmt(n) {
  return n.toLocaleString('es-CO');
}

export default function StatsCards({ stats, loading }) {
  const senado = stats['SENADO'] || { votosGanados: 0, votosPerdidos: 0 };
  const camara = stats['CAMARA'] || { votosGanados: 0, votosPerdidos: 0 };

  if (loading) {
    return (
      <div className={styles.grid}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`${styles.card} ${styles.skeleton}`} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      <div className={`${styles.card} ${styles.green}`}>
        <span className={styles.label}>SENADO — Votos Ganados</span>
        <span className={styles.value}>+{fmt(senado.votosGanados)}</span>
      </div>
      <div className={`${styles.card} ${styles.red}`}>
        <span className={styles.label}>SENADO — Votos Perdidos</span>
        <span className={styles.value}>{fmt(senado.votosPerdidos)}</span>
      </div>
      <div className={`${styles.card} ${styles.green}`}>
        <span className={styles.label}>CAMARA — Votos Ganados</span>
        <span className={styles.value}>+{fmt(camara.votosGanados)}</span>
      </div>
      <div className={`${styles.card} ${styles.red}`}>
        <span className={styles.label}>CAMARA — Votos Perdidos</span>
        <span className={styles.value}>{fmt(camara.votosPerdidos)}</span>
      </div>
    </div>
  );
}
