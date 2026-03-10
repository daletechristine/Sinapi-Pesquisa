import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Proxy for SINAPI API to avoid CORS issues and hide API key
  app.get("/api/sinapi/search", async (req, res) => {
    const { termo, uf, unidade } = req.query;
    const searchTerm = termo as string;
    const searchUnit = unidade as string;
    const apiKey = process.env.SINAPI_API_KEY;

    if (!apiKey) {
      console.error("SINAPI_API_KEY is not set.");
      return res.status(500).json({ error: "SINAPI API key is missing." });
    }

    const fetchFromSINAPI = async (term: string) => {
      try {
        console.log(`Requesting SINAPI Search | Term: "${term}" | UF: "${uf}"`);
        
        // Clean the term for SINAPI
        const cleanTerm = term
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
          .replace(/[^a-zA-Z0-9\s]/g, " ")                // Remove all special chars
          .replace(/\s+/g, " ")                            // Collapse spaces
          .trim();

        const params: any = {
          apikey: apiKey,
          page: 1,
          limit: 10,
          nome: cleanTerm,
          sort: 'nome',
          order: 'asc'
        };
        if (uf && uf !== 'BR') {
          params.estado = uf;
        }

        const [insumosRes, composicoesRes] = await Promise.allSettled([
          axios.get("https://orcamentador.com.br/api/insumos/", { params, timeout: 15000 }),
          axios.get("https://orcamentador.com.br/api/composicoes/", { params, timeout: 15000 })
        ]);

        let items: any[] = [];

        if (insumosRes.status === 'fulfilled' && insumosRes.value.data?.data) {
          const insumos = insumosRes.value.data.data.map((item: any) => ({
            ...item,
            tipo: 'insumo'
          }));
          items = [...items, ...insumos];
        }

        if (composicoesRes.status === 'fulfilled' && composicoesRes.value.data?.data) {
          const composicoes = composicoesRes.value.data.data.map((item: any) => ({
            ...item,
            tipo: 'composicao'
          }));
          items = [...items, ...composicoes];
        }

        // Filter by unit if provided
        if (searchUnit) {
          const unitLower = searchUnit.toLowerCase();
          const unitAliases: Record<string, string[]> = {
            'metro': ['m', 'mt', 'metro', 'metros'],
            'unidade': ['un', 'und', 'unid', 'unidade', 'unidades', 'pc', 'peça', 'peca'],
            'pacote': ['pct', 'pcte', 'pacote', 'pacotes'],
            'caixa': ['cx', 'caixa', 'caixas'],
            'rolo': ['rl', 'rolo', 'rolos'],
            'litro': ['l', 'lt', 'litro', 'litros'],
            'kg': ['kg', 'quilo', 'quilograma', 'kilo']
          };

          const aliases = unitAliases[unitLower] || [unitLower];

          const filteredItems = items.filter((item: any) => {
            const itemUnit = (item.unidade || '').toLowerCase().trim();
            return aliases.includes(itemUnit) || aliases.some(alias => itemUnit.includes(alias));
          });

          if (filteredItems.length > 0) {
            items = filteredItems;
          }
        }

        return items;
      } catch (e: any) {
        console.warn(`SINAPI Search failed for "${term}": ${e.message}`);
        return [];
      }
    };

    try {
      let results = await fetchFromSINAPI(searchTerm);

      // Fallback: Try even broader search if no results
      if (results.length === 0) {
        const words = searchTerm.split(" ").filter(w => w.length > 1);
        if (words.length > 2) {
          const broadTerm = words.slice(0, 2).join(" ");
          console.log(`Fallback: Trying broader term: "${broadTerm}"`);
          results = await fetchFromSINAPI(broadTerm);
        }
      }

      // If SINAPI API fails or returns 0 results, use Gemini AI Fallback
      if (results.length === 0) {
        console.log(`SINAPI API returned 0 results. Using Gemini AI Fallback for: "${searchTerm}"`);
        
        try {
          console.log("GEMINI_API_KEY present:", !!process.env.GEMINI_API_KEY);
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          
          const aiResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Search the web for the average unit price (preço por metro ou unitário) of "${searchTerm}" in recent public biddings or SINAPI tables in the state of ${uf || 'Mato Grosso'}.
            ${searchUnit ? `IMPORTANT: The user specifically requested the price for the unit of measure: "${searchUnit}". Please ensure the price reflects this unit (e.g., if they asked for "Metro", give the price per meter, converting if necessary).` : ''}
            Return a JSON array with up to 3 results. Each object must have:
            - codigo (string, a fake or real SINAPI code)
            - nome (string, the description of the item)
            - unidade (string, the unit of measure, e.g., "${searchUnit || 'un'}")
            - preco_desonerado (string, the price in BRL)
            - preco_naodesonerado (string, the price in BRL)
            - tipo (string, either "insumo" or "composicao")
            If you cannot find exact data, estimate based on market prices for public biddings and provide a plausible source.`,
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    codigo: { type: Type.STRING },
                    nome: { type: Type.STRING },
                    unidade: { type: Type.STRING },
                    preco_desonerado: { type: Type.STRING },
                    preco_naodesonerado: { type: Type.STRING },
                    tipo: { type: Type.STRING }
                  }
                }
              }
            }
          });

          const aiData = JSON.parse(aiResponse.text || "[]");
          console.log("Gemini AI returned:", aiResponse.text);
          
          if (aiData && aiData.length > 0) {
            console.log("Gemini AI successfully found data.");
            return res.json(aiData);
          }
        } catch (aiError: any) {
          console.error("Gemini AI Fallback Error:", aiError.message);
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error("SINAPI Proxy Critical Error:", error.message);
      res.json([]);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
