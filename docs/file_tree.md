# Estrutura de Arquivos — Simulador ECU Web-Based

```
/workspace/
├── app/
│   └── frontend/
│       ├── public/
│       │   ├── arduino_ecu_simulator.ino        # Firmware Arduino (C++)
│       │   ├── favicon.svg                       # Ícone do site
│       │   └── robots.txt                        # SEO
│       ├── src/
│       │   ├── components/
│       │   │   ├── Dashboard.tsx                 # Painel principal com gauges e controles
│       │   │   ├── SensorPanel.tsx               # Controles independentes de sensores (AUTO/MANUAL)
│       │   │   ├── Terminal.tsx                   # Terminal interativo ELM327
│       │   │   ├── DTCPanel.tsx                   # Gerenciamento de DTCs
│       │   │   ├── PlaybackPanel.tsx              # Reprodução e exportação de logs
│       │   │   ├── SchematicPanel.tsx             # Esquemático SVG Arduino↔MCP2515
│       │   │   └── ui/                            # Componentes shadcn/ui
│       │   ├── hooks/
│       │   │   └── use-toast.ts                   # Hook de notificações
│       │   ├── lib/
│       │   │   ├── ecu-simulator.ts               # Motor de simulação ECU (modelo físico + ML)
│       │   │   ├── serial-connection.ts           # Web Serial API para Arduino
│       │   │   ├── dbc-parser.ts                  # Parser de arquivos DBC (Vector CANdb++)
│       │   │   ├── theme-context.tsx              # Contexto de tema claro/escuro
│       │   │   └── utils.ts                       # Utilitários gerais
│       │   ├── pages/
│       │   │   └── Index.tsx                      # Página principal com tabs
│       │   ├── App.tsx                            # Componente raiz
│       │   ├── App.css                            # Estilos globais
│       │   ├── index.css                          # Tailwind imports
│       │   ├── main.tsx                           # Entry point
│       │   └── vite-env.d.ts                      # Tipos Vite
│       ├── index.html                             # HTML base
│       ├── package.json                           # Dependências npm
│       ├── tailwind.config.ts                     # Configuração Tailwind
│       ├── tsconfig.json                          # Configuração TypeScript
│       ├── vite.config.ts                         # Configuração Vite
│       └── todo.md                                # Lista de tarefas
├── data/
│   ├── can_bus_analysis_report.md                 # Relatório de análise de dados CAN
│   ├── can_bus_research_findings.md               # Pesquisa de datasets públicos
│   ├── sensor_correlation_model.json              # Modelo ML exportado (correlações, regressões)
│   ├── datasets/
│   │   ├── synthetic_obd2_driving_data.csv        # 10.000 amostras sintéticas
│   │   └── obd-automotive-data/                   # Dataset Edge Impulse (BMW N53)
│   └── ml_model/
│       └── train_sensor_model.py                  # Script Python de treinamento
├── docs/
│   ├── system_architecture.md                     # Documento de arquitetura do sistema
│   ├── architect.plantuml                         # Diagrama de arquitetura geral
│   ├── class_diagram.plantuml                     # Diagrama de classes
│   ├── sequence_diagram.plantuml                  # Diagrama de sequência (fluxo de dados)
│   ├── can_bus_diagram.plantuml                   # Diagrama do barramento CAN
│   ├── ui_navigation.plantuml                     # Navegação da interface (FSM)
│   ├── ml_integration.plantuml                    # Diagrama de integração ML
│   └── file_tree.md                               # Este arquivo
├── capitulo_simulador_ecu.tex                     # Documentação LaTeX para capítulo acadêmico
└── report_sections/                               # Seções detalhadas do relatório
```

## Tecnologias Utilizadas

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Frontend Framework | React | 18.x |
| Linguagem | TypeScript | 5.x |
| Build Tool | Vite | 5.x |
| CSS Framework | Tailwind CSS | 3.x |
| UI Components | shadcn/ui | latest |
| Comunicação Serial | Web Serial API | Chrome 89+ |
| Hardware | Arduino Uno + MCP2515 | — |
| CAN Bus | ISO 11898 / ISO 15765-4 | 500 kbps |
| ML Training | Python + scikit-learn | 3.x |
| Documentação | LaTeX + Markdown | — |

## Dependências Principais (package.json)

- `react`, `react-dom` — Framework UI
- `typescript` — Tipagem estática
- `tailwindcss` — Estilos utilitários
- `vite` — Bundler e dev server
- `lucide-react` — Ícones
- `recharts` — Gráficos (se utilizado)

## Bibliotecas Arduino

- `SPI.h` — Comunicação SPI (built-in)
- `mcp_can.h` — Controlador MCP2515 (Seeed Studio / Longan Labs)