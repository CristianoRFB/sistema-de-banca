import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { firebaseReady } from '../../app/config';
import { loginAdmin } from '../../infra/firebase/auth';
import { useAdminAuth } from '../../app/providers';

export function PlatformLoginPage() {
  const { user, configured } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (user) navigate('/admin', { replace: true }); }, [user, navigate]);
  if (user) return <Navigate to="/admin" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginAdmin(email, password);
      navigate('/admin', { replace: true });
    } catch {
      setError('Não foi possível entrar. Confira a conta ou fale com quem administra a plataforma.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <span className="brand-mark">77<span>.</span></span>
          <span><b>SAAS BANCA</b><small>PLATFORM OWNER</small></span>
        </div>
        <span className="eyebrow">PLATAFORMA / ACESSO GLOBAL</span>
        <h1>Administração<br /><em>da plataforma.</em></h1>
        <p className="muted-copy">Acesso global aos tenants. Contas de banca usam o painel da própria banca.</p>
        {!firebaseReady && (
          <div className="config-callout" role="status">
            <KeyRound size={17} />
            <span>Este ambiente ainda não recebeu a configuração Web do Firebase.</span>
          </div>
        )}
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label className="field-label">E-mail<Input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field-label">Senha<Input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button block disabled={!configured || loading}>
            {loading ? 'Entrando…' : 'Entrar como Platform Owner'} <ArrowRight size={17} />
          </Button>
        </form>
        <p className="privacy-note"><ShieldCheck size={14} /> Ações globais devem ser auditadas no backend.</p>
      </section>
      <div className="admin-login-art"><span>77<br />SAAS</span><b>GLOBAL<br />ADMIN</b><i>✳</i></div>
    </main>
  );
}
