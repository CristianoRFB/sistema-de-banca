import { useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, MapPin, MessageCircle } from 'lucide-react';
import { BANCA } from '../../app/config';
import { Badge } from '../../components/ui/Badge';
import { obterPerfilPublicoBanca } from '../../features/banca/banca.service';
import type { PerfilPublicoBanca } from '../../features/banca/banca.repository';

const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function formatHours(profile: PerfilPublicoBanca | null) {
  if (!profile?.horarios.length) return BANCA.hours.map((entry) => ({ day: entry.day, hours: entry.hours }));
  return [...profile.horarios]
    .sort((left, right) => left.diaSemana - right.diaSemana)
    .map((entry) => ({
      day: dayNames[entry.diaSemana] ?? `Dia ${entry.diaSemana}`,
      hours: entry.fechado ? 'Fechado' : entry.abre && entry.fecha ? `${entry.abre}–${entry.fecha}` : 'Horário não informado',
    }));
}

export function LocalizacaoPage() {
  const [profile, setProfile] = useState<PerfilPublicoBanca | null>(null);
  useEffect(() => {
    let active = true;
    obterPerfilPublicoBanca().then((value) => { if (active) setProfile(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const address = profile?.endereco.trim() || BANCA.address;
  const phone = profile?.telefone.replace(/\D/g, '') || BANCA.phoneDigits;
  const whatsappPhone = phone.startsWith('55') ? phone : `55${phone}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const hours = formatHours(profile);

  return (
    <div className="location-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">05 · ENCONTRE A BANCA</span><span className="page-count">SANTA FÉ DO SUL / SP</span></div>
      <div className="location-layout">
        <section className="location-main">
          <Badge tone="lime">Ponto de encontro dos leitores</Badge>
          <h1>Histórias boas<br />moram <em>perto.</em></h1>
          <p>Venha conhecer os lançamentos, buscar sua reserva ou pedir uma indicação para a próxima leitura.</p>
          <div className="address-card"><MapPin size={21} /><div><span>ENDEREÇO</span><strong>{address}</strong><small>Santa Fé do Sul · São Paulo</small></div></div>
          <a className="button button--dark" href={mapUrl} target="_blank" rel="noreferrer">Abrir rota no mapa <ArrowUpRight size={17} /></a>
        </section>
        <aside className="hours-card">
          <div className="hours-card__top"><Clock3 size={20} /><span className="eyebrow">HORÁRIOS DA BANCA</span></div>
          <div className="hours-list">{hours.map((entry) => <div key={entry.day}><span>{entry.day}</span><strong>{entry.hours}</strong></div>)}</div>
          <div className="hours-card__note"><span className="status-dot" /> Horários sujeitos a alterações em feriados.</div>
          <a className="hours-card__whatsapp" href={`https://wa.me/${whatsappPhone}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Tire uma dúvida pelo WhatsApp <ArrowUpRight size={15} /></a>
        </aside>
      </div>
      <div className="location-sign"><span>ANA MARIA</span><b>Rua Sete</b><span>SANTA FÉ DO SUL · BRASIL</span><div className="location-sign__sun">☼</div></div>
    </div>
  );
}
