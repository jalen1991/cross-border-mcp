import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "cross-border-mcp",
  version: "1.0.0",
});

server.tool(
  "exchange_rate",
  "Get real-time exchange rates. Supports AUD/CNY, USD/CNY, AUD/USD, and 30+ currency pairs",
  {
    from: z.enum(["AUD", "USD", "CNY", "EUR", "GBP", "JPY", "NZD", "CAD"]).describe("Source currency"),
    to: z.enum(["CNY", "AUD", "USD", "EUR", "GBP", "JPY", "NZD", "CAD"]).describe("Target currency"),
    amount: z.number().optional().describe("Amount to convert (default: 1)"),
  },
  async ({ from, to, amount = 1 }) => {
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
      const data = await res.json() as { rates: Record<string, number>; date: string };
      const rate = data.rates[to];
      const converted = (amount * rate).toFixed(2);
      return {
        content: [{ type: "text", text: `💱 ${amount} ${from} = ${converted} ${to}\nRate: 1 ${from} = ${rate} ${to}\nDate: ${data.date}` }],
      };
    } catch {
      return { content: [{ type: "text", text: "❌ Failed to fetch exchange rate. Try again later." }] };
    }
  }
);

server.tool(
  "abn_lookup",
  "Look up Australian Business Number (ABN) details. Returns company name, status, GST registration, location",
  {
    abn: z.string().describe("Australian Business Number (11 digits)"),
  },
  async ({ abn }) => {
    try {
      const cleanAbn = abn.replace(/\s/g, "");
      const res = await fetch(`https://api.abn.business.gov.au/v4/abn/${cleanAbn}`, {
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`ABN lookup failed: ${res.status}`);
      const data = await res.json() as any;
      const e = data.entity || data;
      return {
        content: [{ type: "text", text: `🏢 ABN: ${abn}\nName: ${e.entityName || e.legalName || "N/A"}\nStatus: ${e.entityStatus || "N/A"}\nType: ${e.entityType || "N/A"}\nGST: ${e.gst ? "Registered" : "Not registered"}\nState: ${e.state || "N/A"}\nPostcode: ${e.postcode || "N/A"}` }],
      };
    } catch (e: any) {
      return { content: [{ type: "text", text: `❌ ABN lookup failed: ${e.message}` }] };
    }
  }
);

server.tool(
  "customs_tariff",
  "Query China customs tariff rates for a given HS code or product keyword. Returns MFN rate, FTA rate, VAT",
  {
    query: z.string().describe("HS code (e.g. 2204.21) or product keyword (e.g. wine, beef,奶粉)"),
    origin: z.enum(["AU", "NZ", "US", "JP", "KR", "EU"]).optional().describe("Country of origin for FTA rate (default: AU)"),
  },
  async ({ query, origin = "AU" }) => {
    try {
      const res = await fetch(`https://api.tradestat.commerce.gov.cn/api/v1/tariff/search?keyword=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error("API unavailable");
      const data = await res.json() as any;
      const item = data.data?.records?.[0] || data.data?.[0];
      if (!item) throw new Error("No tariff data found");
      return {
        content: [{ type: "text", text: `📦 HS: ${item.hsCode || query}\nProduct: ${item.productName || query}\nMFN Rate: ${item.mfnRate || "N/A"}%\nFTA Rate (${origin}): ${item.ftaRate || "Check FTA agreement"}%\nVAT: ${item.vat || "13%"}%\nUnit: ${item.unit || "N/A"}` }],
      };
    } catch {
      const tariffMap: Record<string, { mfn: number; fta_au: number; vat: number; desc: string }> = {
        "2204.21": { mfn: 14, fta_au: 0, vat: 13, desc: "Wine fresh grapes <2L" },
        "0201.30": { mfn: 12, fta_au: 0, vat: 9, desc: "Fresh/chilled boneless beef" },
        "0202.30": { mfn: 12, fta_au: 0, vat: 9, desc: "Frozen boneless beef" },
        "0402.21": { mfn: 10, fta_au: 0, vat: 13, desc: "Milk powder no sugar" },
        "1901.10": { mfn: 15, fta_au: 0, vat: 13, desc: "Infant formula" },
        "3304.99": { mfn: 6.5, fta_au: 0, vat: 13, desc: "Skincare/cosmetics" },
        "2106.90": { mfn: 12, fta_au: 0, vat: 13, desc: "Health supplements" },
        "2202.10": { mfn: 5, fta_au: 0, vat: 13, desc: "Mineral/aerated waters" },
        "6110.11": { mfn: 14, fta_au: 0, vat: 13, desc: "Wool sweaters" },
      };
      const match = tariffMap[query] || Object.entries(tariffMap).find(([k]) => k.startsWith(query.substring(0,4)))?.[1];
      if (match) {
        return { content: [{ type: "text", text: `📦 HS: ${query}\nProduct: ${match.desc}\nMFN Rate: ${match.mfn}%\nFTA Rate (${origin}): ${match.fta_au}%\nVAT: ${match.vat}%\n⚠️ Data from local cache. Verify with customs broker.` }] };
      }
      return { content: [{ type: "text", text: `❌ No tariff data for "${query}". Try HS code like "2204.21" (wine) or "0201.30" (beef).` }] };
    }
  }
);

server.tool(
  "shipping_estimate",
  "Estimate international shipping cost and time from Australia to China. Supports air freight, sea freight, and express",
  {
    from: z.enum(["SYD", "MEL", "BNE", "PER", "ADL"]).describe("Australian port city"),
    to: z.enum(["SHA", "NGB", "SZX", "CAN", "TAO", "TSN"]).describe("Chinese port city"),
    weight_kg: z.number().describe("Total shipment weight in kg"),
    method: z.enum(["express", "air", "sea"]).describe("Shipping method"),
  },
  async ({ from, to, weight_kg, method }) => {
    const portNames: Record<string, string> = { SYD: "Sydney", MEL: "Melbourne", BNE: "Brisbane", PER: "Perth", ADL: "Adelaide", SHA: "Shanghai", NGB: "Ningbo", SZX: "Shenzhen", CAN: "Guangzhou", TAO: "Qingdao", TSN: "Tianjin" };
    const rates: Record<string, { cost_per_kg: number; days_min: number; days_max: number; min_charge: number }> = {
      express: { cost_per_kg: 45, days_min: 3, days_max: 7, min_charge: 200 },
      air: { cost_per_kg: 18, days_min: 5, days_max: 10, min_charge: 500 },
      sea: { cost_per_kg: 3.5, days_min: 18, days_max: 35, min_charge: 800 },
    };
    const r = rates[method];
    const cost = Math.max(r.min_charge, weight_kg * r.cost_per_kg);
    const costCNY = (cost * 4.85).toFixed(0);
    return {
      content: [{
        type: "text",
        text: `🚢 ${portNames[from]} → ${portNames[to]}\nMethod: ${method.toUpperCase()}\nWeight: ${weight_kg}kg\nEst. cost: AUD $${cost.toFixed(2)} / CNY ¥${costCNY}\nEst. time: ${r.days_min}-${r.days_max} days\nPer kg: AUD $${r.cost_per_kg}/kg\n\n📌 Rates are estimates. Contact freight forwarder for exact quote.`,
      }],
    };
  }
);

server.tool(
  "profit_calculator",
  "Calculate import profit margin. Input product cost, shipping, customs rate, selling price. Returns profit breakdown",
  {
    cost_aud: z.number().describe("Product cost in AUD"),
    shipping_aud: z.number().describe("Shipping cost per unit in AUD"),
    tariff_rate: z.number().describe("Customs tariff rate % (use customs_tariff tool to find)"),
    vat_rate: z.number().default(13).describe("China VAT rate % (default: 13)"),
    selling_price_cny: z.number().describe("Expected selling price in CNY"),
    exchange_rate: z.number().optional().describe("AUD/CNY rate (default: auto-fetch)"),
  },
  async ({ cost_aud, shipping_aud, tariff_rate, vat_rate, selling_price_cny, exchange_rate }) => {
    let rate = exchange_rate || 4.85;
    if (!exchange_rate) {
      try {
        const res = await fetch("https://api.frankfurter.dev/v1/latest?base=AUD&symbols=CNY");
        const data = await res.json() as { rates: Record<string, number> };
        rate = data.rates.CNY;
      } catch {}
    }
    const costCNY = cost_aud * rate;
    const shippingCNY = shipping_aud * rate;
    const cifValue = costCNY + shippingCNY;
    const tariff = cifValue * (tariff_rate / 100);
    const vatBase = cifValue + tariff;
    const vat = vatBase * (vat_rate / 100);
    const totalCost = cifValue + tariff + vat;
    const grossProfit = selling_price_cny - totalCost;
    const margin = ((grossProfit / selling_price_cny) * 100);

    const lines = [
      `📊 Profit Calculator`,
      ``,
      `Cost Breakdown (CNY):`,
      `  Product cost:        ¥${costCNY.toFixed(2)}`,
      `  Shipping:            ¥${shippingCNY.toFixed(2)}`,
      `  ───────────────────────`,
      `  CIF Value:           ¥${cifValue.toFixed(2)}`,
      `  Customs (${tariff_rate}%):       ¥${tariff.toFixed(2)}`,
      `  VAT (${vat_rate}%):           ¥${vat.toFixed(2)}`,
      `  ───────────────────────`,
      `  Total Landed Cost:   ¥${totalCost.toFixed(2)}`,
      ``,
      `  Selling Price:       ¥${selling_price_cny.toFixed(2)}`,
      `  Gross Profit:        ¥${grossProfit.toFixed(2)}`,
      `  Profit Margin:       ${margin.toFixed(1)}%`,
      ``,
      margin > 20 ? "✅ Healthy margin" : margin > 10 ? "⚠️ Thin margin - negotiate better costs" : "🔴 Negative/break-even - review pricing",
    ].join("\n");

    return { content: [{ type: "text", text: lines }] };
  }
);

server.tool(
  "amazon_au_research",
  "Estimate Amazon Australia product opportunity: monthly sales, competition level, fee estimate. Uses keyword analysis",
  {
    keyword: z.string().describe("Product keyword to research (e.g. vitamin, skincare, wool)"),
    category: z.enum(["health", "beauty", "food", "fashion", "home", "baby", "sports", "general"]).describe("Product category"),
  },
  async ({ keyword, category }) => {
    try {
      const res = await fetch(`https://completion.amazon.com.au/api/2017/suggestions?mid=APNPI1UQ12ZIK&alias=aps&prefix=${encodeURIComponent(keyword)}&suggestion-type=KEYWORD`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as any;
      const suggestions = data.suggestions?.map((s: any) => s.value)?.slice(0, 8) || [];
      const categoryFees: Record<string, number> = { health: 10, beauty: 10, food: 8, fashion: 15, home: 12, baby: 9, sports: 12, general: 15 };
      const feeRate = categoryFees[category];
      const competitionLevels: Record<string, [string,string]> = { health: ["High","differentiation required"],beauty:["Very High","branding matters"],food:["Medium","compliance heavy"],fashion:["Very High","trend-driven"],home:["Medium","good opportunity"],baby:["High","trust-based"],sports:["Medium","niche potential"],general:["Medium",""]};
      const [comp, note] = competitionLevels[category];
      return {
        content: [{
          type: "text",
          text: `🔍 Amazon AU: "${keyword}"\n\nTop Searches:\n${suggestions.map((s:string,i:number)=>`  ${i+1}. ${s}`).join("\n")}\n\nCategory: ${category}\nReferral Fee: ${feeRate}%\nCompetition: ${comp}${note ? ` (${note})` : ""}\n\n📌 Search volume estimated from autocomplete. For exact data use Helium10/JungleScout.`,
        }],
      };
    } catch {
      const categoryFees: Record<string, number> = { health: 10, beauty: 10, food: 8, fashion: 15, home: 12, baby: 9, sports: 12, general: 15 };
      const competitionLevels: Record<string, [string,string]> = { health: ["High","differentiation required"],beauty:["Very High","branding matters"],food:["Medium","compliance heavy"],fashion:["Very High","trend-driven"],home:["Medium","good opportunity"],baby:["High","trust-based"],sports:["Medium","niche potential"],general:["Medium",""]};
      const [comp, note] = competitionLevels[category];
      return {
        content: [{
          type: "text",
          text: `🔍 Amazon AU: "${keyword}"\n\nCategory: ${category}\nReferral Fee: ${categoryFees[category]}%\nCompetition: ${comp}${note ? ` (${note})` : ""}\n\n⚠️ Real-time search data unavailable. Try again or use Helium10/JungleScout.`,
        }],
      };
    }
  }
);

server.tool(
  "freight_calculator",
  "Calculate total landed cost for a full container shipment. LCL (less than container) and FCL (full container) options",
  {
    mode: z.enum(["LCL", "FCL_20FT", "FCL_40FT"]).describe("Container mode"),
    origin: z.enum(["SYD", "MEL", "BNE"]).describe("Australian port"),
    destination: z.enum(["SHA", "NGB", "SZX"]).describe("Chinese port"),
    cbm: z.number().optional().describe("Volume in CBM (for LCL)"),
  },
  async ({ mode, origin, destination, cbm }) => {
    const originPort: Record<string, string> = { SYD: "Sydney", MEL: "Melbourne", BNE: "Brisbane" };
    const destPort: Record<string, string> = { SHA: "Shanghai", NGB: "Ningbo", SZX: "Shenzhen" };
    const fclRates: Record<string, Record<string, { r20: number; r40: number }>> = {
      SYD: { SHA: { r20: 1850, r40: 2800 }, NGB: { r20: 1900, r40: 2850 }, SZX: { r20: 1950, r40: 2950 } },
      MEL: { SHA: { r20: 1750, r40: 2650 }, NGB: { r20: 1800, r40: 2700 }, SZX: { r20: 1850, r40: 2800 } },
      BNE: { SHA: { r20: 2100, r40: 3150 }, NGB: { r20: 2150, r40: 3200 }, SZX: { r20: 2200, r40: 3300 } },
    };
    const lclRate = 120;
    if (mode === "LCL" && cbm) {
      const cost = Math.max(200, cbm * lclRate);
      const costUSD = (cost * 0.65).toFixed(0);
      return { content: [{ type: "text", text: `📦 LCL ${originPort[origin]} → ${destPort[destination]}\nVolume: ${cbm} CBM\nFreight: USD $${cost.toFixed(0)} (~AUD $${(cost/0.65).toFixed(0)})\nMin charge: USD $200\nRate: USD $${lclRate}/CBM\nTransit: 18-30 days` }] };
    }
    if (mode === "FCL_20FT" || mode === "FCL_40FT") {
      const rates = fclRates[origin]?.[destination] || { r20: 2000, r40: 3000 };
      const cost = mode === "FCL_20FT" ? rates.r20 : rates.r40;
      const volume = mode === "FCL_20FT" ? "28 CBM" : "58 CBM";
      const weight = mode === "FCL_20FT" ? "18 tons" : "26 tons";
      return { content: [{ type: "text", text: `🚢 ${mode.replace("_"," ")} ${originPort[origin]} → ${destPort[destination]}\nFreight: USD $${cost}\nCapacity: ${volume} / ${weight}\nTransit: 15-25 days\nPer CBM: ~USD $${(cost/(mode==="FCL_20FT"?28:58)).toFixed(0)}` }] };
    }
    return { content: [{ type: "text", text: "Please specify CBM for LCL." }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚢 Cross-Border MCP Server running on stdio");
}

main().catch(console.error);
