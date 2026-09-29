import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, MapPin, Share2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../infra/browser/api-client';
import { catalogoRepository } from '../../features/catalogo/catalogo.repository';
import { ReservarProdutoSheet } from '../../features/reservas/components/ReservarProdutoSheet';
import type { ProdutoCatalogo } from '../../features/catalogo/catalogo.types';
import { BANCA } from '../../app/config';

export function ProdutoPage() {
  const { itemReparteId = '' } = useParams();
  const [product, setProduct] = useState<ProdutoCatalogo | null>(null);
  const [loadState, setLoadState] = useState<'ready' | 'not-found' | 'failure'>('ready');
  const [retry, setRetry] = useState(0);
  const [demo, setDemo] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const requestKey = `${itemReparteId}:${retry}`;
  const [loadedRequestKey, setLoadedRequestKey] = useState('');

  useEffect(() => {
    let active = true;
    catalogoRepository.get(itemReparteId).then((value) => {
      if (active) { setProduct(value); setDemo(false); setLoadState('ready'); setLoadedRequestKey(requestKey); }
    }).catch(async (cause: unknown) => {
      if (import.meta.env.DEV) {
        const { demoCatalogo } = await import('../../features/catalogo/demoCatalogo');
        const sample = demoCatalogo.find((item) => itemReparteId === item.itemReparteId);
        if (!active) return;
        if (sample) { setProduct(sample); setDemo(true); setLoadState('ready'); }
        else setLoadState(cause instanceof ApiError && cause.status === 404 ? 'not-found' : 'failure');
        setLoadedRequestKey(requestKey);
      } else if (active) {
        setLoadState(cause instanceof ApiError && cause.status === 404 ? 'not-found' : 'failure');
        setLoadedRequestKey(requestKey);
      }
    });
    return () => { active = false; };
  }, [itemReparteId, requestKey]);

  if (loadedRequestKey !== requestKey) return <div className="page-wrap loading-block" role="status" aria-live="polite">Abrindo a ficha do título <span className="loading-dots">···</span></div>;
  if (loadState === 'not-found') return <div className="page-wrap empty-state"><span className="eyebrow">TÍTULO NÃO ENCONTRADO</span><h1>Essa página saiu<br />da prateleira.</h1><Link className="button button--dark" to="/catalogo"><ArrowLeft size={17} /> Voltar ao catálogo</Link></div>;
  if (loadState === 'failure' || !product) return <div className="page-wrap empty-state" role="alert"><span className="eyebrow">CATÁLOGO INDISPONÍVEL</span><h1>Não foi possível abrir este título.</h1><p>Confira sua conexão e tente novamente.</p><Button variant="secondary" type="button" onClick={() => setRetry((attempt) => attempt + 1)}>Tentar novamente</Button><Link className="back-link" to="/catalogo"><ArrowLeft size={17} /> Voltar ao catálogo</Link></div>;

  const available = product.quantidadeDisponivel !== null && product.quantidadeDisponivel > 0;
  const price = product.preco == null ? 'Consulte na banca' : product.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="product-page page-wrap">
      <Link className="back-link" to="/catalogo"><ArrowLeft size={17} /> Catálogo</Link>
      {demo && <div className="demo-ribbon"><span>Amostra de desenvolvimento</span> Sem estoque ou preço publicado. Este título não pode ser reservado.</div>}
      <section className="product-detail">
        <div className="product-detail__poster" aria-label="Capa indisponível; exibição tipográfica">
          <div className="poster__top"><span>ANA MARIA / CATÁLOGO</span><span>01—06</span></div>
          <span className="poster__glyph">読</span>
          <div className="poster__title"><span>{product.tipo}</span><strong>{product.titulo}</strong>{product.volume && <b>VOL. {product.volume}</b>}</div>
          <span className="poster__vertical">HISTÓRIAS QUE CHEGAM ATÉ VOCÊ</span>
        </div>
        <div className="product-detail__info">
          <div className="page-kicker"><span className="eyebrow">FICHA DO TÍTULO</span><span className="page-count">ID. {product.id.slice(0, 8).toUpperCase()}</span></div>
          <Badge tone={available ? (product.quantidadeDisponivel! <= 3 ? 'orange' : 'lime') : 'muted'}>{available ? `${product.quantidadeDisponivel} ${product.quantidadeDisponivel === 1 ? 'unidade disponível' : 'unidades disponíveis'}` : 'Disponibilidade não informada'}</Badge>
          <h1>{product.titulo}{product.volume && <em> · vol. {product.volume}</em>}</h1>
          {product.nomeOriginal && <p className="original-title">Título original: {product.nomeOriginal}</p>}
          {product.sinopse && <p className="product-synopsis">{product.sinopse}</p>}
          <div className="product-meta">
            {product.editora && <div><span>EDITORA</span><strong>{product.editora}</strong></div>}
            <div><span>TIPO</span><strong>{product.tipo}</strong></div>
            <div><span>PREÇO</span><strong>{price}</strong></div>
          </div>
          <div className="product-actions">
            <Button disabled={!product.permiteReserva || demo} onClick={() => setReserveOpen(true)}>{available && product.permiteReserva ? 'Reservar este volume' : 'Reserva indisponível'} <ArrowUpRight size={17} /></Button>
            <a className="button button--secondary" href={`https://wa.me/${BANCA.phoneDigits}?text=${encodeURIComponent(`Olá! Tenho interesse em ${product.titulo}${product.volume ? `, volume ${product.volume}` : ''}.`)}`} target="_blank" rel="noreferrer">Perguntar à banca <Share2 size={16} /></a>
          </div>
          {product.dataFimReservas && <p className="reservation-cutoff"><CalendarDays size={15} /> Reservas até {new Date(`${product.dataFimReservas.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}.</p>}
          <div className="product-location-note"><MapPin size={17} /><span>Retirada presencial em <b>{BANCA.city}</b>. A confirmação é feita pela equipe da banca.</span></div>
        </div>
      </section>
      <div className="product-footnote"><span>LEIA. COMPARTILHE. VOLTE PARA MAIS.</span><Link to="/localizacao">Visite a banca <ArrowUpRight size={15} /></Link></div>
      <ReservarProdutoSheet produto={product} open={reserveOpen} onClose={() => setReserveOpen(false)} />
    </div>
  );
}
