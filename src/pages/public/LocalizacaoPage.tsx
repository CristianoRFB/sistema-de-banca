import { ArrowUpRight, Clock3, MapPin, MessageCircle } from 'lucide-react';
import { BANCA } from '../../app/config';
import { Badge } from '../../components/ui/Badge';

export function LocalizacaoPage() {
  return (
    <div className="location-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">05 · ENCONTRE A BANCA</span><span className="page-count">SANTA FÉ DO SUL / SP</span></div>
      <div className="location-layout">
        <section className="location-main">
          <Badge tone="lime">Ponto de encontro dos leitores</Badge>
          <h1>Histórias boas<br />moram <em>perto.</em></h1>
          <p>Venha conhecer os lançamentos, buscar sua reserva ou pedir uma indicação para a próxima leitura.</p>
          <div className="address-card"><MapPin size={21} /><div><span>ENDEREÇO</span><strong>{BANCA.address}</strong><small>Santa Fé do Sul · São Paulo</small></div></div>
          <a className="button button--dark" href={BANCA.mapsUrl} target="_blank" rel="noreferrer">Abrir rota no mapa <ArrowUpRight size={17} /></a>
        </section>
        <aside className="hours-card">
          <div className="hours-card__top"><Clock3 size={20} /><span className="eyebrow">HORÁRIOS DA BANCA</span></div>
          <div className="hours-list">{BANCA.hours.map((entry) => <div key={entry.day}><span>{entry.day}</span><strong>{entry.hours}</strong></div>)}</div>
          <div className="hours-card__note"><span className="status-dot" /> Horários sujeitos a alterações em feriados.</div>
          <a className="hours-card__whatsapp" href={`https://wa.me/${BANCA.phoneDigits}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Tire uma dúvida pelo WhatsApp <ArrowUpRight size={15} /></a>
        </aside>
      </div>
      <div className="location-sign"><span>ANA MARIA</span><b>Rua Sete</b><span>SANTA FÉ DO SUL · BRASIL</span><div className="location-sign__sun">☼</div></div>
    </div>
  );
}
