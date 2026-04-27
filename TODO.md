# TODO

## Performance (Windows + 32 canais)
- [ ] Medir carga real (CPU/RAM) no Windows em 32ch: 1 músico vs 8 músicos; coletar `/api/audio-debug` e ajustar parâmetros.
  - Prompt: "Rode o desktop-server no Windows com captura em 32 canais; teste com 1 músico e depois com 8 músicos conectados; registre CPU/RAM e exporte `/api/audio-debug` (underruns, buffered bytes, gaps) e proponha ajustes objetivos (blockSamples, audio_buffer_size, throttles)."
- [ ] Converter pipeline de mix do servidor para índices/TypedArrays (evitar `Record<string, number>` por sample).
  - Prompt: "Refatore o loop de áudio do `apps/desktop-server/main-process/server.cjs` para representar `mono` por canal como `Float32Array(32)` indexado; crie cache `channelIndexById` e altere o mixer do `@inear/protocol` para aceitar `monoByIndex` sem lookup por string; mantenha compatibilidade com a API atual."
- [ ] Processar áudio por bloco (vetorizado) para reduzir overhead por sample.
  - Prompt: "Altere o pipeline do servidor para processar áudio em blocos (por exemplo `blockSamples`) usando TypedArrays e loops únicos por bloco; minimize alocações dentro de `audioTick`; valide que a latência e o áudio continuam estáveis."
- [ ] Mover DSP pesado para Worker Thread (ou módulo nativo) quando efeitos entrarem (evita travar event loop).
  - Prompt: "Introduza um Worker Thread no desktop-server para executar processamento DSP (EQ/comp/reverb/delay) fora do event loop; defina um protocolo de mensagens com buffers transferíveis; garanta fallback para modo sem worker."
- [ ] Mobile RN: virtualizar lista de canais (FlatList) e memoizar channel strip para 32 faders sem engasgo.
  - Prompt: "No app mobile (`apps/mobile`), troque a renderização da lista de canais para `FlatList` com `getItemLayout`, `keyExtractor`, `initialNumToRender` e memoização de `ChannelStrip`; garanta que arrastar fader não dispara re-render do grid inteiro."
- [ ] Ajustar polling do mobile: acelera após interação, desacelera em idle; evitar re-render em cascata.
  - Prompt: "Implemente estratégia de polling adaptativo no mobile: após interação (fader/mute/EQ), faça polling rápido por 1–2s e depois volte ao intervalo normal; reduza atualizações de estado para evitar cascatas de render."
- [ ] Criar modo “Performance UI” (menos blur/gradiente/animações).
  - Prompt: "Adicione uma configuração 'Performance UI' no mobile e no painel web para reduzir sombras pesadas/blur/animações; use estilos mais simples quando ativo; mantenha legibilidade e contraste."

## UI/UX (cara de mesa de som)
- [x] Definir direção visual “console”: scribble strip, LED meters segmentados, knobs, botões latch, bancos (1–8/9–16/…).
  - Tokens em `packages/design-system/src/tokens.ts` (paleta, escala dB, segmentos de meter, dimensões de strip/fader/knob).
- [x] Criar componentes base reutilizáveis: `ScribbleStrip`, `LedButton`, `Meter`, `Knob`, `ChannelStrip`, `FaderScale`.
  - `apps/mobile/components/`: `ScribbleStrip`, `LedButton`, `Meter`, `Knob`, `ChannelStrip`, `FaderScale`, `VerticalFader` (consome `FaderScale`).
- [x] Implementar “bank switching” (8 canais por banco) + “overview” (32 mini-strips com meters).
  - `RetornoMixerControls`: aba Canais com bancos 1-8/9-16/… + aba Overview com mini-strips clicáveis que pulam para o banco do canal.
- [ ] Gestos: double tap reset (pan/gain), long press rename, swipe trocar banco.
  - Parcial: double-tap reset implementado em `Knob` e `VerticalFader` (via `resetValue`). Falta: long-press rename e swipe entre bancos.
- [x] Aplicar mesma linguagem visual no desktop Admin (painel) e no mobile (músico).
  - `apps/desktop-server/src/index.css` exporta variáveis `--console-*` espelhando os tokens; AdminApp usa `.console-brand` + `.console-led` no header.

## Efeitos (in-ear: por músico + PEQ por canal)
- [ ] Definir modelo de dados no `@inear/protocol`:
  - [ ] `PeqBand` / `PeqSettings`
    - Prompt: "No `packages/protocol`, crie os tipos `PeqBand` e `PeqSettings` (tipo de filtro, freq, Q, gain, enabled) e exporte no index; inclua defaults e validação de ranges."
  - [ ] `CompressorSettings`
    - Prompt: "No `packages/protocol`, crie `CompressorSettings` (threshold/ratio/attack/release/knee/makeup/enabled) com defaults e validação de ranges; exporte no index."
  - [ ] `peqByChannel` no `MusicianStrip`
    - Prompt: "Extenda `MusicianStrip` para suportar `peqByChannel: Record<channelId, PeqSettings>`; atualize migrações e testes para garantir backward compatibility."
  - [ ] `masterComp` (e opcional `masterEq`) no `MusicianStrip`
    - Prompt: "Extenda `MusicianStrip` com `masterComp` (e opcional `masterEq`); atualize migração de showfile para preencher defaults quando ausente."
- [ ] Implementar DSP base (protocol ou desktop-server):
  - [ ] Biquads (RBJ) com estado por banda
    - Prompt: "Implemente biquads RBJ (LPF/HPF/Bell/LowShelf/HighShelf) com coeficientes calculados por sampleRate; mantenha estado (z1/z2) por banda e por stream."
  - [ ] Processamento por bloco (Float32Array) com coeficientes cacheados
    - Prompt: "Implemente processamento de PEQ por bloco usando `Float32Array`; cacheie coeficientes por banda enquanto parâmetros não mudarem; evite alocações por tick."
- [ ] Desktop-server: aplicar PEQ no mono de cada canal antes do mix por músico.
  - Prompt: "No `apps/desktop-server/main-process/server.cjs`, aplique PEQ por canal (por músico) no caminho do `mono` antes do somatório; use processamento por bloco e caches; garanta que 32 canais continuam em tempo real."
- [ ] Desktop-server: aplicar compressor/limiter no estéreo final do músico (proteção auditiva / anti-clip).
  - Prompt: "Implemente compressor/limiter no bus estéreo final do músico antes de codificar/enviar; inclua indicador de redução de ganho e proteção contra clipping."
- [ ] Criar presets (Voz, Caixa, Baixo, Keys) para PEQ e compressor.
  - Prompt: "Crie presets práticos (Voz/Caixa/Baixo/Keys) para PEQ por canal e compressor master; exponha no UI e mantenha valores conservadores para palco."
- [ ] Criar endpoints para editar FX:
  - [ ] `PATCH /api/showfile/musician/:id` suportar novos campos (peq/comp)
    - Prompt: "Estenda o endpoint `PATCH /api/showfile/musician/:id` para aceitar e persistir `peqByChannel` e `masterComp`; valide payload e responda o músico atualizado."
  - [ ] Validar ranges e persistir no state
    - Prompt: "Implemente validação de ranges (freq/Q/gain/ratio/attack/release) no backend e garanta persistência segura no state sem quebrar showfiles antigos."
- [ ] UI Admin (desktop web): configurar FX por músico (aba do músico).
  - Prompt: "No painel Admin (`apps/desktop-server/src/AdminApp.tsx`), adicione uma seção/aba dentro de cada músico para editar FX daquele músico: PEQ por canal (seleciona canal → bandas), compressor master, presets, bypass; salvar via PATCH no músico."
- [ ] UI mobile: configurar FX por músico (tela do músico) com EQ por canal + master comp; sliders/knobs; bypass por banda.
  - Prompt: "No mobile (`apps/mobile`), adicione UI dentro da tela do músico para editar FX do próprio músico: tela de EQ por canal com knobs/sliders, bypass por banda e gráfico simples; e tela/aba para compressor master com controles essenciais; salvar via PATCH no músico."
- [ ] Telemetria: medidor pre/post FX e indicador de limiter/clipping.
  - Prompt: "Adicione telemetria no servidor para níveis pre/post FX e indicador de limiter; exponha via endpoint e mostre no mobile e no Admin (por músico) com LEDs/meters."

## Efeitos (fase 2: ambiência)
- [ ] Delay simples por músico (tempo/feedback/mix) com ring buffer.
  - Prompt: "Implemente delay estéreo por músico com ring buffer (tempo ms, feedback, mix) configurável por músico; processe por bloco e limite CPU/memória; adicione bypass e preset básico; exponha no Admin e no mobile."
- [ ] Reverb por send (ideal: um reverb global com send por músico) para controlar CPU.
  - Prompt: "Implemente reverb leve por send (ideal 1 instância global) com send e retorno configuráveis por músico; ofereça tamanho/decay/mix; mantenha CPU sob controle em 32ch; exponha no Admin e no mobile."
