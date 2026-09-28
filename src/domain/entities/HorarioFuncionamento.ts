/** diaSemana segue Date.getDay(): domingo=0, segunda=1, ... sábado=6. */
export interface HorarioFuncionamento {
  id?: string;
  diaSemana: number;
  fechado: boolean;
  abre: string | null;
  fecha: string | null;
}