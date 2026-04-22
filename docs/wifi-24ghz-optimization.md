# Otimizacao WiFi 2.4 GHz

## Objetivo

Reduzir a latencia operacional do retorno na banda `2.4 GHz` para ficar abaixo de `1000 ms`
nas operacoes criticas, com monitoramento continuo e comparacao objetiva antes/depois.

## Analise Do Ambiente

1. Validar a topologia:
   - Servidor desktop ligado por `Ethernet` ao access point.
   - SSID dedicado para palco sempre que possivel.
   - Dispositivos de retorno isolados de trafego de internet publica.
2. Levantar interferencias:
   - Bluetooth.
   - Micro-ondas.
   - Iluminacao sem fio.
   - Receptores IEM.
   - Celulares extras conectados ao mesmo SSID.
3. Medir baseline no painel `Rede e motor de audio`:
   - `RTT`.
   - `jitter`.
   - `gaps/min`.
   - `e2e medio`.
   - `e2e p95`.
   - `SLA < 1000 ms`.

## Configuracao Recomendada Do AP

- Usar apenas canais `1`, `6` ou `11`.
- Fixar largura de canal em `20 MHz`.
- Ativar `WMM/QoS`.
- Priorizar trafego de voz/audio para o SSID de palco.
- Se o equipamento suportar, marcar audio com `DSCP EF (46)`.
- Desativar recursos agressivos de economia de energia no AP quando afetarem fila e jitter.

## Ajustes Implementados No App

- Perfil agressivo `pro` para palco em `5 GHz`, com buffers minimos e fila curta.
- Perfil dedicado `wifi24` no player WebView.
- Codec mais leve `mu-law` no perfil `wifi24` para reduzir bytes por frame no WebSocket/UDP.
- Codec adaptativo no `5 GHz PRO`: mantem `PCM16` em rede limpa e cai para `mu-law` quando o backlog do socket sobe.
- Telemetria continua com envio de:
  - `rttMs`
  - `aheadMs`
  - `estimatedE2eMs`
  - `queueDepth`
  - `drops`
  - `underruns`
  - `slaOver1s`
- Reacao automatica quando a estimativa de latencia ultrapassa `1000 ms`.
- Painel admin com recomendacoes operacionais para 2.4 GHz.

## Teste Comparativo

1. Capturar metricas base antes de ajustar o AP.
2. Aplicar:
   - canal menos congestionado entre `1/6/11`
   - `20 MHz`
   - `WMM/QoS`
   - SSID dedicado
3. Repetir o mesmo teste com o perfil `2.4 - otimizada`.
4. Comparar:
   - `RTT medio`
   - `jitter`
   - `gaps/min`
   - `e2e medio`
   - `e2e p95`
   - `violacoes do SLA`

## Operacao 5 GHz No Palco

- Selecionar `5 - palco PRO` no app.
- Manter o access point dedicado ao retorno, com servidor ligado por `Ethernet`.
- Ativar `WMM/QoS` e priorizacao de voz.
- Usar canal 5 GHz limpo; em RF denso, preferir `40 MHz` para estabilidade.
- Monitorar `estimatedE2eP95Ms`, `drops`, `underruns` e `queuedFrames`.

## Criterio De Aceitacao

- Objetivo minimo: tempo de envio percebido `< 4 s`.
- Objetivo ideal: `estimatedE2eP95Ms < 1000`.
- `estimatedE2eP95Ms < 1000`
- `slaBreaches = 0`
- `gaps/min` controlado
- `RTT` e `jitter` sem crescimento progressivo durante a sessao
