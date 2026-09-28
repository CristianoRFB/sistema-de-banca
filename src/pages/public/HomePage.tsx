import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, MapPin, Search, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BANCA } from '../../app/config';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { ProdutoCardTipografico } from '../../features/catalogo/components/ProdutoCardTipografico';
import type { ProdutoCatalogo } from '../../features/catalogo/catalogo.types';
import { catalogoRepository } from '../../features/catalogo/catalogo.repository';

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ProdutoCatalogo[]>([]);
  const [lowStockItems, setLowStockItems] = useState<ProdutoCatalogo[]>([]);
  const [source, setSource] = useState<'live' | 'demo' | 'empty'>('empty');

  useEffect(() => {
    let active = true;
    catalogoRepository.list({ busca: '', disponibilidade: 'ULTIMAS_UNIDADES', ordenar: 'RECENTES' }).then((page) => {
      if (active) setLowStockItems(page.itens.filter((item) => item.quantidadeDisponivel != null && item.quantidadeDisponivel > 0 && item.quantidadeDisponivel <= 3).slice(0, 6));
    }).catch(() => { if (active) setLowStockItems([]); });
    return () => { active = false; };
  }, []);

  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const isOpen = now.getDay() >= 1 && now.getDay() <= 5
    ? minutes >= 480 && minutes < 1080
    : now.getDay() === 6 && minutes >= 480 && minutes < 780;

  useEffect(() => {
    let active = true;
    catalogoRepository.list({ busca: '', ordenar: 'RECENTES' }).then((page) => {
      if (!active) return;
      setItems(page.itens);
      setSource('live');
    }).catch(async () => {
      if (import.meta.env.DEV && active) {
        const { demoCatalogo } = await import('../../features/catalogo/demoCatalogo');
        if (active) { setItems(demoCatalogo.slice(0, 6)); setSource('demo'); }
      } else if (active) {
        setItems([]);
        setSource('empty');
      }
    });
    return () => { active = false; };
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    navigate(`/catalogo${params.size ? `?${params}` : ''}`);
  }

  return (
    <div className="home-page">
      <section className="hero-band">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="status-dot" /> Santa Fé do Sul · desde sempre por aqui</div>
          <p className="hero-index">BANCA DE LEITURA <span>001 / SFDS</span></p>
          <h1>Histórias<br />que <em>chegam</em><br />até você.</h1>
          <p className="hero-description">Seu próximo volume favorito pode estar a poucos passos. Explore as novidades da banca.</p>
          <form className="hero-search" onSubmit={submitSearch} role="search">
            <Search size={19} aria-hidden="true" />
            <Input aria-label="Buscar título ou volume" placeholder="Busque por título ou volume" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" aria-label="Buscar"><ArrowRight size={19} /></button>
          </form>
          <div className="hero-actions">
            <Link className="button button--dark" to="/catalogo">Explorar catálogo <ArrowUpRight size={17} /></Link>
            <Link className="hero-text-link" to="/localizacao"><MapPin size={16} /> Como chegar</Link>
          </div>
        </div>
        <div className="hero-art" aria-label="Ilustração gráfica editorial da banca">
          <div className="hero-art__sun" />
          <div className="hero-art__vertical">ANA MARIA · SANTA FÉ DO SUL · ANA MARIA ·</div>
          <div className="hero-art__number">AM<br /><span>17</span></div>
          <div className="hero-art__stamp">NOVAS<br />HISTÓRIAS<br /><b>TODO DIA</b></div>
          <div className="hero-art__line" />
          <div className="hero-art__caption">Uma banca.<br />Muitas jornadas.</div>
          <div className="hero-art__cross">✳</div>
        </div>
        <div className="hero-bottomline"><span>LEITURA DE BAIRRO, HISTÓRIAS SEM FRONTEIRA</span><ArrowDownRight size={16} /><span>ROLE PARA EXPLORAR</span></div>
      </section>

      {lowStockItems.length > 0 && <section className="content-section low-stock-section" aria-labelledby="low-stock-title">
        <div className="section-heading">
          <div><p className="eyebrow section-eyebrow">PRATELEIRA / POUCAS UNIDADES</p><h2 id="low-stock-title">Últimos exemplares,<br /><em>por enquanto.</em></h2></div>
          <Link className="section-link" to="/catalogo">Explorar catálogo <ArrowRight size={17} /></Link>
        </div>
        <div className="product-grid">{lowStockItems.map((item, index) => <ProdutoCardTipografico key={item.itemReparteId} produto={item} index={index} />)}</div>
      </section>}

      {source === 'demo' && <div className="demo-ribbon"><span>Prévia de desenvolvimento</span> Amostras sem preço e sem estoque publicado. Nenhuma reserva pode ser feita por elas.</div>}

      <section className="content-section new-arrivals" aria-labelledby="new-arrivals-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow section-eyebrow"><Sparkles size={15} /> ACABOU DE CHEGAR</p>
            <h2 id="new-arrivals-title">Capítulos novos,<br /><em>todo dia.</em></h2>
          </div>
          <Link className="section-link" to="/catalogo">Ver catálogo completo <ArrowRight size={17} /></Link>
        </div>
        {items.length ? (
          <div className="product-grid product-grid--featured">
            {items.map((item, index) => <ProdutoCardTipografico key={item.itemReparteId} produto={item} index={index} />)}
          </div>
        ) : (
          <div className="empty-catalog">
            <span className="empty-catalog__number">—</span>
            <div><h3>Estamos preparando o catálogo.</h3><p>Enquanto isso, fale com a banca pelo WhatsApp e pergunte pelas novidades.</p></div>
            <a className="button button--secondary" href={`https://wa.me/${BANCA.phoneDigits}`} target="_blank" rel="noreferrer">Chamar no WhatsApp ↗</a>
          </div>
        )}
      </section>

      <section className="explore-strip">
        <div className="explore-strip__mark">読</div>
        <div><p className="eyebrow">LEITURA É CAMINHO</p><h2>Tem espaço para<br />mais uma história.</h2></div>
        <Link to="/catalogo" className="round-link" aria-label="Explorar catálogo"><ArrowRight /></Link>
        <span className="explore-strip__side">ENCONTRE SEU PRÓXIMO FAVORITO</span>
      </section>

      <section className="visit-section">
        <div className="visit-section__label"><span className="eyebrow">04 · APAREÇA</span><Badge tone={isOpen ? 'lime' : 'muted'}>{isOpen ? 'Aberta agora' : 'Fechada agora'}</Badge></div>
        <div className="visit-section__body"><h2>Seu ponto<br />de parada.</h2><p>Um lugar para encontrar o próximo volume, trocar indicações e descobrir o que acabou de chegar.</p><Link className="button button--dark" to="/localizacao">Endereço e horários <ArrowRight size={17} /></Link></div>
        <div className="visit-section__address"><MapPin size={19} /><span>{BANCA.address}</span></div>
      </section>
    </div>
  );
}
