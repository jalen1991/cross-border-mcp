# 🚢 Cross-Border MCP Server

> AI-powered cross-border e-commerce toolkit for Australian exports to China.

Your AI agent (Claude Code, Cursor, Codex) becomes a cross-border trade expert.

## Tools

| Tool | Description | Real API |
|------|-------------|----------|
| `exchange_rate` | Live AUD/CNY/USD rates | frankfurter.dev ✅ |
| `abn_lookup` | Australian company verification | abn.business.gov.au ✅ |
| `customs_tariff` | China import tariff rates | tradestat.commerce.gov.cn ✅ |
| `shipping_estimate` | Air/sea/express cost + time | Built-in rate tables |
| `profit_calculator` | Full landed cost + margin | Combines all tools |
| `amazon_au_research` | Amazon AU product opportunity | amazon.com.au autocomplete ✅ |
| `freight_calculator` | LCL/FCL container shipping | Real market rates |

## Quick Start

```bash
cd cross-border-mcp
npm install
npm run dev
```

## Connect to Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "cross-border-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/Users/jalen2026/tools/cross-border-mcp"
    }
  }
}
```

Then ask Claude:
- "查一下今天澳元兑人民币汇率"
- "帮我算从悉尼运20FT红酒到上海的利润"
- "查询 ABN 12345678901 这家公司"
- "红酒进入中国的关税是多少"

## Example Session

```
> 帮我算进口一批澳洲牛肉到中国的利润

🔄 Using exchange_rate (AUD→CNY)
🔄 Using customs_tariff (HS 0201.30 beef)
🔄 Using freight_calculator (MEL→SHA FCL_20FT)
🔄 Using profit_calculator

📊 Profit Calculator
Cost Breakdown (CNY):
  Product cost:        ¥242,500
  Shipping:            ¥9,700
  Customs (0% FTA):    ¥0
  VAT (9%):            ¥22,698
  Total Landed Cost:   ¥274,898
  Selling Price:       ¥350,000
  Gross Profit:        ¥75,102
  Profit Margin:       21.5%
✅ Healthy margin
```

## License

MIT
