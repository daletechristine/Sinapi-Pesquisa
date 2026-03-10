import axios from 'axios';

export interface SINAPIItem {
  codigo: string;
  nome: string;
  unidade: string;
  preco_desonerado: string;
  preco_naodesonerado: string;
  tipo_insumo?: string;
  familia?: string;
  data_referencia?: string;
  estado?: string;
  tipo: 'insumo' | 'composicao';
}

export async function searchSINAPI(termo: string, uf: string = 'MT', unidade?: string): Promise<SINAPIItem[]> {
  try {
    const response = await axios.get('/api/sinapi/search', {
      params: { termo, uf, unidade }
    });
    return response.data || [];
  } catch (error) {
    console.error('Error searching SINAPI:', error);
    return [];
  }
}
