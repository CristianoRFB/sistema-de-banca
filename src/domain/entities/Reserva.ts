import type { IntencaoRetirada } from "../enums/IntencaoRetirada";
import type { ReservaStatus } from "../enums/ReservaStatus";

export interface Reserva {
  id: string;
  bancaId: string;
  clienteId: string;
  clienteNomeSnapshot: string;
  clienteTelefoneFinal: string;
  criadaEm: Date;
  dataRetiradaPretendida: Date;
  horarioAproximado: string | null;
  expiraEm: Date;
  status: ReservaStatus;
  intencaoRetirada: IntencaoRetirada;
  lembreteMeioEnviado: boolean;
  lembreteDiaEnviado: boolean;
  lembreteFechamentoEnviado: boolean;
  atualizadaEm: Date;
}