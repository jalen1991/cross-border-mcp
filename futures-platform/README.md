# AlphaQuant Futures

期货量化策略研发工作台：K 线与指标、六套策略回测、参数网格寻优、模拟报单和事前风控。

行情是按合约规格生成的仿真样本，界面标注为 Sample Market Feed。回测按下一根 K 线开盘价撮合，并计入滑点、手续费、保证金和 ATR 跟踪止损。参数热力图按后 30% 样本外夏普选参，六套策略在同一段行情上横评。

```bash
cd futures-platform
npm install
npm test
npm run dev
```

开发服务默认地址：`http://127.0.0.1:5173/`。
