import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import type { ProdutoCatalogo } from '../catalogo.types';

const palettes = ['card--ink', 'card--lime', 'card--orange', 'card--cream'];

export function ProdutoCardTipografico({ produto, index = 0 }: { produto: ProdutoCatalogo; index?: number }) {
  const palette = palettes[index % palettes.length];
  return (
    <Link className={`product-card ${palette}`} to={`/produto/${encodeURIComponent(produto.itemReparteId)}`}>
      <div className="product-card__topline">
        <span className="eyebrow">{produto.tipo}</span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </div>
      <div className="product-card__title-wrap">
        {produto.volume && <span className="product-card__volume">VOL. {produto.volume}</span>}
        <h3>{produto.titulo}</h3>
        {produto.nomeOriginal && <span className="product-card__original">{produto.nomeOriginal}</span>}
      </div>
      <div className="product-card__bottomline">
        {produto.demonstracao
          ? <Badge tone="muted">Amostra</Badge>
          : produto.quantidadeDisponivel !== null && produto.quantidadeDisponivel > 0
            ? <Badge tone={produto.quantidadeDisponivel <= 3 ? 'orange' : 'lime'}>{produto.quantidadeDisponivel <= 3 ? 'Últimas unidades' : 'Disponível'}</Badge>
            : <Badge tone="muted">Indisponível</Badge>}
        <span className="product-card__price">{produto.preco == null ? 'Consulte' : produto.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
      </div>
      <span className="product-card__serial" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    </Link>
  );
}
