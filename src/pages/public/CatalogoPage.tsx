import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ProdutoCardTipografico } from '../../features/catalogo/components/ProdutoCardTipografico';
import { catalogoRepository } from '../../features/catalogo/catalogo.repository';
import { pesquisarLocalmente } from '../../features/catalogo/catalogo.service';
import type { FiltrosCatalogo, ProdutoCatalogo } from '../../features/catalogo/catalogo.types';

const types: Array<{ label: string; value: FiltrosCatalogo['tipo'] }> = [
  { label: 'Tudo', value: 'TODOS' }, { label: 'Mangá', value: 'MANGA' }, { label: 'Revista', value: 'REVISTA' },
  { label: 'Box', value: 'BOX' }, { label: 'Colecionável', value: 'COLECIONAVEL' }, { label: 'Outro', value: 'OUTRO' },
];

export function CatalogoPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [type, setType] = useState<FiltrosCatalogo['tipo']>('TODOS');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [items, setItems] = useState<ProdutoCatalogo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [failure, setFailure] = useState(false);
  const [retry, setRetry] = useState(0);

  const filters = useMemo<FiltrosCatalogo>(() => ({
    busca: query,
    tipo: type,
    disponibilidade: onlyAvailable ? 'DISPONIVEIS' : 'TODOS',
    ordenar: 'RECENTES',
  }), [query, type, onlyAvailable]);

  useEffect(() => {
    const q = filters.busca.trim();
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setFailure(false);
      setLoadMoreFailed(false);
      setHasMore(false);
      setNextCursor(null);
      catalogoRepository.list({ ...filters, busca: q }).then((page) => {
        if (!active) return;
        setItems(page.itens);
        setNextCursor(page.proximoCursor);
        setHasMore(page.temMais);
        setDemo(false);
      }).catch(async () => {
        if (import.meta.env.DEV && active) {
          const { demoCatalogo } = await import('../../features/catalogo/demoCatalogo');
          if (!active) return;
          setItems(demoCatalogo);
          setNextCursor(null);
          setHasMore(false);
          setDemo(true);
        } else if (active) {
          setItems([]);
          setFailure(true);
        }
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 180);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [filters, retry]);

  const visible = demo ? pesquisarLocalmente(items, filters) : items;

  async function loadMore() {
    if (!nextCursor || !hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await catalogoRepository.list(filters, nextCursor);
      setItems((current) => {
        const currentIds = new Set(current.map((item) => item.itemReparteId));
        const newItems = page.itens.filter((item) => {
          if (currentIds.has(item.itemReparteId)) return false;
          currentIds.add(item.itemReparteId);
          return true;
        });
        return [...current, ...newItems];
      });
      setNextCursor(page.proximoCursor);
      setHasMore(page.temMais);
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value.trim()); else next.delete('q');
    setParams(next, { replace: true });
  }

  return (
    <div className="catalog-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">ARQUIVO ABERTO · BANCA ANA MARIA</span><span className="page-count">CAT. / 001</span></div>
      <header className="catalog-heading"><h1>Encontre sua<br /><em>próxima leitura.</em></h1><p>Busque por título, volume ou editora. Sem pressa: as boas histórias ficam.</p></header>
      {demo && <div className="demo-ribbon"><span>Prévia de desenvolvimento</span> As sugestões abaixo são apenas amostras; não possuem estoque nem preço publicado.</div>}
      <div className="catalog-toolbar">
        <label className="catalog-search"><Search size={19} /><Input aria-label="Buscar no catálogo" placeholder="Ex.: Wind Breaker, vol. 25" value={query} onChange={(event) => changeQuery(event.target.value)} /></label>
        <div className="catalog-filter-label"><SlidersHorizontal size={16} /> FILTRAR POR</div>
      </div>
      <div className="filter-row" role="group" aria-label="Filtrar por tipo">
        {types.map((item) => <button type="button" key={item.value} aria-pressed={type === item.value} className={`filter-pill${type === item.value ? ' is-selected' : ''}`} onClick={() => setType(item.value)}>{item.label}</button>)}
        <label className="availability-toggle"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /><span>Disponíveis</span></label>
      </div>
      <div className="catalog-results-heading"><p>{loading ? 'Buscando títulos…' : `${visible.length} ${visible.length === 1 ? 'título' : 'títulos'}`}</p><span>Volume preservado como publicado</span></div>
      {loading ? <div className="loading-block" role="status" aria-live="polite" aria-busy="true">Organizando as prateleiras <span className="loading-dots">···</span></div>
        : failure ? <div className="empty-state" role="alert"><h2>Não foi possível carregar o catálogo.</h2><p>Confira sua conexão e tente novamente em instantes.</p><Button variant="secondary" type="button" onClick={() => setRetry((attempt) => attempt + 1)}>Tentar novamente</Button></div>
          : visible.length ? <div className="product-grid">{visible.map((item, index) => <ProdutoCardTipografico key={item.itemReparteId} produto={item} index={index} />)}</div>
            : hasMore
              ? <div className="empty-state"><span className="eyebrow">CONTINUANDO A BUSCA</span><h2>Confira mais títulos.</h2><p>A busca continua nas próximas páginas do catálogo.</p></div>
              : <div className="empty-state"><span className="eyebrow">NENHUM TÍTULO ENCONTRADO</span><h2>Tente outra busca.</h2><p>Revise o título, volume ou filtro escolhido.</p><button type="button" className="text-button" onClick={() => { setType('TODOS'); setOnlyAvailable(false); changeQuery(''); }}>Limpar filtros</button></div>}
      {loadMoreFailed && <p className="form-error" role="alert">Não foi possível carregar a próxima página.</p>}
      {!loading && !failure && hasMore && <div className="catalog-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Carregando…' : loadMoreFailed ? 'Tentar novamente' : 'Carregar mais títulos'}</Button></div>}
    </div>
  );
}
