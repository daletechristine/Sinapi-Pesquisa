import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function extractItemsFromImage(base64Image: string, mimeType: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Analise esta imagem de uma planilha ou lista de materiais.
    Extraia a descrição de todos os materiais encontrados na coluna de especificações ou descrição.
    Retorne apenas uma lista JSON de strings, onde cada string é a descrição clara do item.
    Ignore cabeçalhos e rodapés.
    Exemplo de saída: ["Cabo de rede CAT 6", "Eletroduto PEAD 2 polegadas"]
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: base64Image.split(",")[1] || base64Image,
              mimeType
            }
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]") as string[];
  } catch (e) {
    console.error("Error parsing Gemini response:", e);
    return [];
  }
}
