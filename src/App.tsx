import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Search, 
  FileSpreadsheet, 
  Loader2, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle,
  Code,
  ChevronDown,
  ChevronUp,
  Type as TypeIcon,
  Image as ImageIcon,
  Eye,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as XLSX from 'xlsx';
import { extractItemsFromImage } from './services/geminiService';
import { searchSINAPI, SINAPIItem } from './services/sinapiService';

interface ResultItem {
  originalDescription: string;
  averagePrice: number;
  sources: {
    price: number;
    org: string;
    date: string;
    link: string;
    unidadeMedida?: string;
    quantidade?: number;
    descricao?: string;
    codigo?: string;
    tipo?: string;
  }[];
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SearchItem {
  description: string;
  unit: string;
}

export default function App() {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [inputMode, setInputMode] = useState<'image' | 'text'>('image');
  const [manualText, setManualText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [uf, setUf] = useState('MT');
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setError(null);
    setItems([]);
    setResults([]);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const extracted = await extractItemsFromImage(base64, file.type);
        setItems(extracted.map(desc => ({ description: desc, unit: '' })));
        setIsExtracting(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Erro ao processar imagem. Tente novamente.");
      setIsExtracting(false);
    }
  };

  const handleManualTextSubmit = () => {
    const lines = manualText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (lines.length === 0) {
      setError("Por favor, insira ao menos um item.");
      return;
    }

    setItems(lines.map(line => ({ description: line, unit: '' })));
    setResults([]);
    setExpandedResults(new Set());
    setError(null);
  };

  const startEditing = (index: number, value: string) => {
    setEditingIndex(index);
    setEditValue(value);
  };

  const saveEdit = () => {
    if (editingIndex !== null) {
      const newItems = [...items];
      newItems[editingIndex].description = editValue;
      setItems(newItems);
      setEditingIndex(null);
    }
  };

  const updateUnit = (index: number, unit: string) => {
    const newItems = [...items];
    newItems[index].unit = unit;
    setItems(newItems);
  };

  const deleteItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const toggleExpand = (index: number) => {
    const newSet = new Set(expandedResults);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedResults(newSet);
  };

  const runSearch = async () => {
    if (items.length === 0) return;
    setIsSearching(true);
    setError(null);
    const newResults: ResultItem[] = [];

    for (const item of items) {
      const sinapiData = await searchSINAPI(item.description, uf, item.unit);
      
      if (sinapiData.length > 0) {
        // Sort by name or just take the top 10
        const sorted = sinapiData.slice(0, 10);

        const parsePrice = (price: any) => {
          if (typeof price === 'number') return price;
          if (typeof price === 'string') {
            // If it has a comma, assume Brazilian format (e.g. 1.234,56 -> 1234.56)
            if (price.includes(',')) {
              return parseFloat(price.replace(/\./g, '').replace(',', '.')) || 0;
            }
            // Otherwise assume US format (e.g. 1234.56)
            return parseFloat(price) || 0;
          }
          return 0;
        };

        const avg = sorted.reduce((acc, curr) => acc + parsePrice(curr.preco_desonerado), 0) / sorted.length;

        newResults.push({
          originalDescription: item.description,
          averagePrice: avg,
          sources: sorted.map(s => ({
            price: parsePrice(s.preco_desonerado),
            org: 'SINAPI',
            date: s.data_referencia ? (() => {
              try {
                const parts = s.data_referencia.split('T')[0].split('-');
                if (parts.length === 3) {
                  return `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                return s.data_referencia;
              } catch (e) {
                return s.data_referencia;
              }
            })() : new Date().toLocaleDateString('pt-BR'),
            link: `https://orcamentador.com.br/`,
            unidadeMedida: s.unidade,
            quantidade: 1,
            descricao: s.nome,
            codigo: s.codigo,
            tipo: s.tipo
          }))
        });
      } else {
        newResults.push({
          originalDescription: item.description,
          averagePrice: 0,
          sources: []
        });
      }
    }

    setResults(newResults);
    setIsSearching(false);
  };

  const generateExcelData = () => {
    const data: any[] = [];
    
    results.forEach(r => {
      if (r.sources.length === 0) {
        data.push({
          'Nome Pesquisado': r.originalDescription,
          'Nome no SINAPI': 'Não encontrado',
          'Valor Unitário Médio': 'Não encontrado',
          'Preço Desonerado': 'N/A',
          'Unidade de Medida': 'N/A',
          'Código SINAPI': 'N/A',
          'Tipo': 'N/A',
          'Data de Referência': 'N/A',
          'Link Oficial da Fonte': 'N/A'
        });
      } else {
        r.sources.forEach((s, idx) => {
          data.push({
            'Nome Pesquisado': r.originalDescription,
            'Nome no SINAPI': s.descricao || 'N/A',
            'Valor Unitário Médio': r.averagePrice > 0 ? r.averagePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'N/A',
            'Preço Desonerado': s.price ? s.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'N/A',
            'Unidade de Medida': s.unidadeMedida || 'N/A',
            'Código SINAPI': s.codigo || 'N/A',
            'Tipo': s.tipo || 'N/A',
            'Data de Referência': s.date || 'N/A',
            'Link Oficial da Fonte': s.link || 'N/A'
          });
        });
      }
    });
    return data;
  };

  const exportToExcel = () => {
    const data = generateExcelData();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mapa de Preços");
    XLSX.writeFile(wb, "mapa_precos_automatizado.xlsx");
    setShowPreviewModal(false);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="text-white w-5 h-5" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Pesquisa de Preços SINAPI</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowCode(!showCode)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors"
            >
              <Code className="w-4 h-4" />
              {showCode ? "Ocultar Explicação" : "Ver Explicação Técnica"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Hero Section */}
        <section className="text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
            Automação de Pesquisa de Mercado
          </h2>
          <p className="text-slate-500">
            Extraia itens de imagens e automatize a busca de preços no Portal Nacional de Contratações Públicas (Lei 14.133/21).
          </p>
        </section>

        {/* Step 1: Input Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">1</span>
                <h3 className="font-semibold">Entrada de Dados</h3>
              </div>
              
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setInputMode('image')}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                    inputMode === 'image' ? "bg-white shadow-sm text-emerald-600" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  <ImageIcon className="w-3 h-3" />
                  Imagem
                </button>
                <button 
                  onClick={() => setInputMode('text')}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                    inputMode === 'text' ? "bg-white shadow-sm text-emerald-600" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  <TypeIcon className="w-3 h-3" />
                  Texto
                </button>
              </div>
            </div>
            
            {inputMode === 'image' ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group"
              >
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <Upload className="text-slate-400 group-hover:text-emerald-600 w-6 h-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-700">Clique para enviar imagem</p>
                  <p className="text-xs text-slate-400 mt-1">PNG, JPG ou PDF</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  accept="image/*"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <textarea 
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Cole aqui a lista de itens (um por linha)...&#10;Ex:&#10;Cabo de rede CAT 6&#10;Eletroduto PEAD 2 polegadas"
                  className="w-full h-32 p-3 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all resize-none font-mono"
                />
                <button 
                  onClick={handleManualTextSubmit}
                  className="w-full py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  Processar Lista de Texto
                </button>
              </div>
            )}

            {isExtracting && (
              <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                Gemini extraindo itens...
              </div>
            )}

            {items.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Itens Identificados</p>
                  <button 
                    onClick={() => setItems([])}
                    className="text-[10px] text-red-500 hover:underline font-bold uppercase"
                  >
                    Limpar Tudo
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-lg bg-slate-50 p-2 space-y-1">
                  {items.map((item, idx) => (
                    <div key={idx} className="text-sm p-2 bg-white rounded border border-slate-200 flex flex-col gap-2 group">
                      <div className="flex items-center justify-between">
                        {editingIndex === idx ? (
                          <div className="flex items-center gap-2 w-full">
                            <input 
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEdit}
                              onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                              autoFocus
                              className="flex-1 text-sm border-b border-emerald-500 outline-none"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 truncate flex-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span className="truncate">{item.description}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => startEditing(idx, item.description)}
                                className="p-1 text-slate-400 hover:text-emerald-600"
                                title="Editar termo de busca"
                              >
                                <Code className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={() => deleteItem(idx)}
                                className="p-1 text-slate-400 hover:text-red-500"
                                title="Remover item"
                              >
                                <AlertCircle className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pl-5">
                        <span className="text-xs text-slate-400">Unidade:</span>
                        <select 
                          value={item.unit}
                          onChange={(e) => updateUnit(idx, e.target.value)}
                          className="text-xs border border-slate-200 rounded p-1 outline-none focus:border-emerald-500 bg-slate-50 text-slate-600"
                        >
                          <option value="">Qualquer (Automático)</option>
                          <option value="Unidade">Unidade</option>
                          <option value="Metro">Metro</option>
                          <option value="Pacote">Pacote</option>
                          <option value="Caixa">Caixa</option>
                          <option value="Rolo">Rolo</option>
                          <option value="Litro">Litro</option>
                          <option value="Kg">Kg</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <p className="text-[10px] text-amber-700 leading-tight">
                    <strong>Dica:</strong> Se um item não for encontrado, tente simplificar a descrição (ex: remova medidas muito específicas como "4,0 MM²").
                  </p>
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Filtrar por Região (UF)</label>
                  <select 
                    value={uf}
                    onChange={(e) => setUf(e.target.value)}
                    className="w-full p-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="">Brasil (Média Nacional)</option>
                    <optgroup label="Estados (UF)">
                      <option value="AC">Acre</option>
                      <option value="AL">Alagoas</option>
                      <option value="AP">Amapá</option>
                      <option value="AM">Amazonas</option>
                      <option value="BA">Bahia</option>
                      <option value="CE">Ceará</option>
                      <option value="DF">Distrito Federal</option>
                      <option value="ES">Espírito Santo</option>
                      <option value="GO">Goiás</option>
                      <option value="MA">Maranhão</option>
                      <option value="MT">Mato Grosso</option>
                      <option value="MS">Mato Grosso do Sul</option>
                      <option value="MG">Minas Gerais</option>
                      <option value="PA">Pará</option>
                      <option value="PB">Paraíba</option>
                      <option value="PR">Paraná</option>
                      <option value="PE">Pernambuco</option>
                      <option value="PI">Piauí</option>
                      <option value="RJ">Rio de Janeiro</option>
                      <option value="RN">Rio Grande do Norte</option>
                      <option value="RS">Rio Grande do Sul</option>
                      <option value="RO">Rondônia</option>
                      <option value="RR">Roraima</option>
                      <option value="SC">Santa Catarina</option>
                      <option value="SP">São Paulo</option>
                      <option value="SE">Sergipe</option>
                      <option value="TO">Tocantins</option>
                    </optgroup>
                  </select>
                </div>

                <button 
                  onClick={runSearch}
                  disabled={isSearching}
                  className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm shadow-emerald-200"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Pesquisar Preços {uf ? `em ${uf}` : 'no Brasil'}
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Results */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">2</span>
              <h3 className="font-semibold">Resultados da Pesquisa</h3>
            </div>

            {isSearching && (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                <p className="text-sm animate-pulse">Consultando API do SINAPI...</p>
              </div>
            )}

            {!isSearching && results.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2 border-2 border-slate-50 rounded-xl">
                <AlertCircle className="w-8 h-8 opacity-20" />
                <p className="text-sm">Os resultados aparecerão aqui</p>
              </div>
            )}

            {!isSearching && results.length > 0 && (
              <div className="space-y-4">
                <div className="max-h-[400px] overflow-y-auto space-y-3 pr-2">
                  {results.map((res, idx) => (
                    <div key={idx} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Nome Pesquisado</p>
                          <h4 className="text-sm font-bold text-slate-800 line-clamp-2">{res.originalDescription}</h4>
                          {res.sources.length > 0 && (
                            <div className="mt-2">
                              <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Nome no SINAPI (Melhor Correspondência)</p>
                              <p className="text-xs text-slate-600 line-clamp-2">{res.sources[0].descricao}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-right shrink-0">
                          {res.sources.length > 0 && (
                            <div className="border-r border-slate-200 pr-4">
                              <p className="text-[10px] text-slate-400 uppercase font-bold">No SINAPI</p>
                              <p className="text-slate-700 font-bold text-sm">
                                {res.sources[0].price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </p>
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1 justify-end group/tooltip relative">
                              <p className="text-[10px] text-slate-400 uppercase font-bold cursor-help">Média</p>
                              <div className="absolute bottom-full right-0 mb-1 w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-10 pointer-events-none">
                                Média calculada com base em até 10 itens encontrados no SINAPI.
                              </div>
                            </div>
                            <p className="text-emerald-600 font-bold text-sm">
                              {res.averagePrice > 0 
                                ? res.averagePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                : 'Não encontrado'}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {res.sources.length > 0 && (
                        <div className="pt-2 border-t border-slate-200/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Data de Referência ({res.sources[0].date})</p>
                            <a 
                              href={res.sources[0].link} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-emerald-600 hover:underline flex items-center gap-1 font-medium text-xs"
                            >
                              Ver no SINAPI <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="flex flex-col gap-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-600 font-medium truncate max-w-[250px]">{res.sources[0].org}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="bg-slate-100 px-2 py-0.5 rounded-md font-medium">
                                {res.sources[0].unidadeMedida || 'Unidade'}
                              </span>
                              {res.sources[0].codigo && (
                                <span className="text-slate-400 font-mono">Cód: {res.sources[0].codigo}</span>
                              )}
                              {res.sources[0].tipo && (
                                <span className="text-slate-400 capitalize">{res.sources[0].tipo}</span>
                              )}
                            </div>
                          </div>

                          {res.sources.length > 1 && (
                            <div className="pt-2">
                              <button 
                                onClick={() => toggleExpand(idx)}
                                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 uppercase flex items-center gap-1 transition-colors"
                              >
                                {expandedResults.has(idx) ? (
                                  <>Ocultar fontes <ChevronUp className="w-3 h-3" /></>
                                ) : (
                                  <>Ver todas as {res.sources.length} fontes da média <ChevronDown className="w-3 h-3" /></>
                                )}
                              </button>
                              
                              {expandedResults.has(idx) && (
                                <div className="mt-3 space-y-3 border-l-2 border-slate-200 pl-3">
                                  {res.sources.slice(1).map((source, sIdx) => (
                                    <div key={sIdx} className="flex flex-col gap-1 text-xs">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-bold text-slate-400 uppercase">{source.date}</span>
                                          <span className="text-slate-600 font-medium truncate max-w-[180px]">{source.org}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="font-bold text-slate-700">
                                            {source.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                          </span>
                                          <a 
                                            href={source.link} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-emerald-600 hover:underline flex items-center gap-1 font-medium text-[10px]"
                                          >
                                            SINAPI <ExternalLink className="w-3 h-3" />
                                          </a>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
                                        <span className="bg-slate-100 px-2 py-0.5 rounded-md font-medium">
                                          {source.unidadeMedida || 'Unidade'}
                                        </span>
                                        {source.codigo && (
                                          <span className="text-slate-400 font-mono">Cód: {source.codigo}</span>
                                        )}
                                        {source.tipo && (
                                          <span className="text-slate-400 capitalize">{source.tipo}</span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-600 line-clamp-2" title={source.descricao}>
                                        <span className="font-semibold text-slate-500 mr-1">Nome no SINAPI:</span>
                                        {source.descricao}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowPreviewModal(true)}
                    className="flex-1 py-3 bg-white border-2 border-slate-900 text-slate-900 rounded-xl font-medium hover:bg-slate-50 flex items-center justify-center gap-2 transition-all"
                  >
                    <Eye className="w-4 h-4" />
                    Visualizar Planilha
                  </button>
                  <button 
                    onClick={exportToExcel}
                    className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 flex items-center justify-center gap-2 transition-all"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Baixar Excel Direto
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Technical Explanation */}
        <AnimatePresence>
          {showCode && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-slate-900 rounded-2xl p-8 text-slate-300 space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code className="text-emerald-400 w-5 h-5" />
                  <h3 className="text-xl font-bold text-white">Como o script funciona? (Instrução Pedagógica)</h3>
                </div>
                <button onClick={() => setShowCode(false)} className="text-slate-500 hover:text-white">
                  <ChevronUp />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed">
                    Para automatizar essa tarefa em Python, usamos a biblioteca <code className="text-emerald-400">requests</code> para conversar com a API do SINAPI e o <code className="text-emerald-400">pandas</code> para organizar os dados.
                  </p>
                  
                  <div className="space-y-2">
                    <h4 className="text-white font-semibold text-sm">1. Construção da URL (O "Segredo")</h4>
                    <p className="text-xs text-slate-400">
                      O SINAPI usa um padrão fixo para os links. No código, usamos <strong>f-strings</strong> para preencher os dados que recebemos da API:
                    </p>
                    <pre className="bg-black/50 p-4 rounded-lg text-xs font-mono overflow-x-auto border border-white/5">
{`# Exemplo de como montar a requisição em Python:
import requests

api_key = "SUA_CHAVE"
estado = "MT"
termo = "cimento"

# O 'f' antes das aspas permite colocar variáveis entre { }
url = f"https://orcamentador.com.br/api/insumos/?apikey={api_key}&estado={estado}&nome={termo}"

resposta = requests.get(url)
dados = resposta.json()
print(dados)`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="text-white font-semibold text-sm">2. Lógica de Busca e Média</h4>
                    <p className="text-xs text-slate-400">
                      O script percorre cada item extraído pela IA, faz a busca filtrando por <strong>MT</strong>, ordena pelos mais recentes e calcula a média aritmética dos valores unitários.
                    </p>
                    <pre className="bg-black/50 p-4 rounded-lg text-xs font-mono overflow-x-auto border border-white/5">
{`import pandas as pd

# Lista de preços encontrados
precos = [10.50, 11.20, 10.80]

# Cálculo da média simples
media = sum(precos) / len(precos)

# Criando o Excel final
df = pd.DataFrame(resultados)
df.to_excel("mapa_precos_automatizado.xlsx", index=False)`}
                    </pre>
                  </div>
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <p className="text-xs text-emerald-400">
                      <strong>Dica de Especialista:</strong> Sempre verifique se a unidade de medida (ex: metro vs rolo) é a mesma antes de validar a média final!
                    </p>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {error && (
          <div className="fixed bottom-8 right-8 bg-red-50 border border-red-200 p-4 rounded-xl shadow-lg flex items-center gap-3 text-red-700 animate-in slide-in-from-bottom-4 z-50">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {/* Preview Modal */}
        <AnimatePresence>
          {showPreviewModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowPreviewModal(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
              >
                <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Pré-visualização da Planilha</h2>
                      <p className="text-sm text-slate-500">Confira os dados antes de exportar para o Excel</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowPreviewModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-hidden p-6 flex flex-col">
                  <div className="border border-slate-200 rounded-xl overflow-auto flex-1">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="p-3 border-b border-slate-200">Nome Pesquisado</th>
                          <th className="p-3 border-b border-slate-200">Nome no SINAPI</th>
                          <th className="p-3 border-b border-slate-200">Valor Médio</th>
                          <th className="p-3 border-b border-slate-200">Preço Desonerado</th>
                          <th className="p-3 border-b border-slate-200">Unidade</th>
                          <th className="p-3 border-b border-slate-200">Código SINAPI</th>
                          <th className="p-3 border-b border-slate-200">Data Ref.</th>
                          <th className="p-3 border-b border-slate-200">Tipo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {generateExcelData().map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 max-w-[200px] truncate" title={row['Nome Pesquisado']}>{row['Nome Pesquisado']}</td>
                            <td className="p-3 max-w-[200px] truncate" title={row['Nome no SINAPI']}>{row['Nome no SINAPI']}</td>
                            <td className="p-3 font-medium text-emerald-600">{row['Valor Unitário Médio']}</td>
                            <td className="p-3 font-medium">{row['Preço Desonerado']}</td>
                            <td className="p-3 text-slate-500">{row['Unidade de Medida']}</td>
                            <td className="p-3 max-w-[200px] truncate" title={row['Código SINAPI']}>{row['Código SINAPI']}</td>
                            <td className="p-3 text-slate-500">{row['Data de Referência']}</td>
                            <td className="p-3 max-w-[150px] truncate capitalize" title={row['Tipo']}>{row['Tipo']}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                  <button 
                    onClick={() => setShowPreviewModal(false)}
                    className="px-6 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={exportToExcel}
                    className="px-6 py-2.5 bg-emerald-600 text-white font-medium hover:bg-emerald-700 rounded-xl flex items-center gap-2 shadow-sm shadow-emerald-200 transition-all"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Confirmar e Baixar Excel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-12 py-8 bg-white">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Especialista em Automação de Dados</p>
          <p className="text-sm text-slate-500">Desenvolvido para conformidade com a Lei 14.133/21</p>
        </div>
      </footer>
    </div>
  );
}
