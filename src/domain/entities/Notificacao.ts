import type { TipoNotificacao } from "../enums/TipoNotificacao";

export type DestinatarioNotificacao = "CLIENTE" | "ADMIN";
export type NotificacaoStatus = "PENDENTE" | "ENVIADA" | "FALHOU" | "CANCELADA";

export interface Notificacao {
  id: string;
  bancaId: string;
  clienteId: string | null;
  reservaId: string | null;
  destinatarioTipo: DestinatarioNotificacao;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  agendadaPara: Date | null;
  enviadaEm: Date | null;
  lida: boolean;
  status: NotificacaoStatus;
}