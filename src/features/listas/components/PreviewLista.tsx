import type { ImportedListRow } from '../../importacao/importacao.types';

export function PreviewLista({ title, rows }: { title: string; rows: readonly ImportedListRow[] }) {
  return <section className="customer-preview" aria-label="Prévia como cliente">
    <span className="eyebrow">NOVIDADES · BANCA ANA MARIA</span>
    <h2>{title}</h2>
    <p>Confira o que acabou de chegar à banca.</p>
    <div className="preview-products">{rows.map((row) => <article className="preview-product" key={row.id}><span>読</span><strong>{row.title}</strong><small>{row.volume ? `Vol. ${row.volume}` : 'Volume não informado'}</small>{row.price != null && <b>{row.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b>}</article>)}</div>
  </section>;
}
