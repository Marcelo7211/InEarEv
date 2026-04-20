# inEarApp

Monitor in-ear estéreo via LAN (Wi‑Fi): servidor **Electron** (Windows/macOS) com API HTTP + UDP, app móvel **Expo** (`apps/mobile`, testável no **Expo Go**) e pacote compartilhado `@inear/protocol`.

## Requisitos

- Node.js 20+ (raiz do monorepo)
- **Expo Go** no telefone (iOS/Android) para testes rápidos na mesma Wi‑Fi

## Desenvolvimento — desktop

```bash
npm install
npm run dev
```

Credenciais padrão (primeira execução cria `inear-state.json` em `userData` do Electron):

| Usuário     | Senha        | Papel     |
|------------|--------------|-----------|
| `admin`    | `admin123`   | admin     |
| `musician1` | `musician1` | músico    |
| `musician2` | `musician2` | músico    |

Portas fixas no MVP:

- HTTP API: `3847` (bind `0.0.0.0`)
- UDP áudio: `9876`
- UDP controle (registro): `9877`

## Captura do áudio que sai do PC (teste, opcional)

Por defeito o servidor gera **senoides** por canal — **não é o som do YouTube nem dos altifalantes**. O browser manda áudio para o dispositivo de saída do macOS; o inEar só “ouve” isso se o **ffmpeg** capturar um sinal que contenha esse áudio (loopback ou dispositivo virtual).

Define **`INEAR_CAPTURE_CMD`** no **mesmo terminal** onde vais correr `npm run dev` (o Electron herda o ambiente desse processo). O comando deve escrever **PCM s16le intercalado, 48 kHz**, no **stdout** (`-ac 2` para estéreo ou **`-ac N`** se usares o fluxo multi-canal abaixo).

### Várias interfaces / muitas entradas (mesa até 32 canais)

O servidor abre **um** fluxo de captura com **N** canais intercalados (amostra: `ch0, ch1, …, chN-1` por tick). Para somar, por exemplo, **Avid + outra interface** no mesmo Mac:

1. Abre **Configuração de áudio MIDI** (Audio MIDI Setup) → **Janela** → **Dispositivo de áudio agregado** (Aggregate Device).  
2. Marca as interfaces físicas que queres combinar; o agregado aparece na lista AVFoundation com um **número de entradas** (depende do hardware e do agregado).  
3. No painel **Entrada Mac** do inEar: escolhe o agregado; com **N automático** (ffprobe), o servidor ajusta `captureChannelCount` ao iniciar a captura. Podes forçar **N** manualmente e desligar o automático. **Aplicar N + ganhos** reinicia o `ffmpeg`; depois **Sincronizar faixas** — cria-se `if_0` … `if_{N-1}` com nomes editáveis em **Canais**. Cada músico mantém sends/EQ por faixa no telemóvel.  
4. Se usares **`INEAR_CAPTURE_CMD`**, o teu comando tem de usar o **mesmo** `-ac N` que o N guardado no estado (o painel grava `captureChannelCount` em `inear-state.json`). Opcional: **`INEAR_FFPROBE`** com caminho absoluto se o `ffprobe` não estiver ao lado do `ffmpeg`.

### YouTube / som do sistema no macOS

1. Instala [BlackHole 2ch](https://existential.audio/blackhole/) (ou equivalente).  
2. Abre **Configuração de áudio MIDI** → cria um **dispositivo com saídas múltiplas** (Multi-Output Device) com **Saída integrada + BlackHole** e define o Mac a usar esse dispositivo como saída — assim ouves no PC **e** o sinal vai para o BlackHole.  
3. Na raiz do repo, corre **`npm run inear:mac:capture-cmd`**: o script lista entradas AVFoundation, tenta detetar BlackHole e imprime o `export INEAR_CAPTURE_CMD='…'` pronto a colar no **mesmo terminal** onde vais arrancar o desktop. Opcional: `node tools/mac-print-capture-cmd.cjs --index N` se quiseres forçar o índice.  
4. Cola o `export`, depois **`npm run dev`** nesse terminal.

A API `GET /api/session` (com JWT) devolve `pcAudioCaptureConfigured` e `pcAudioCaptureReceiving` para o app móvel mostrar se a captura está realmente a alimentar o mix.

Outros exemplos (ajusta `:N` ao teu `ffmpeg -f avfoundation -list_devices true -i ""`):

- **macOS** (mesmo formato que na secção YouTube acima, outro índice se precisares):  
  `export INEAR_CAPTURE_CMD='ffmpeg -nostats -loglevel error -f avfoundation -i ":1" -ar 48000 -ac 2 -f s16le -'`
- **Windows** (loopback WASAPI, ajusta o nome do dispositivo):  
  `set INEAR_CAPTURE_CMD=ffmpeg -nostats -loglevel error -f wasapi -i loopback -ar 48000 -ac 2 -f s16le -`
- **Linux** (Pulse):  
  `export INEAR_CAPTURE_CMD='ffmpeg -nostats -loglevel error -f pulse -i default -ar 48000 -ac 2 -f s16le -'`

Depois: `npm run dev` noutro terminal (ou no mesmo script de arranque). Se o buffer do ffmpeg ficar vazio, o servidor volta aos senoides nesse bloco e avisa no log.

### Como saber se a captura está a funcionar

1. **Teste no Mac (sem abrir o inEar):** grava uns segundos com o mesmo `ffmpeg`/AVFoundation que o servidor usa e reproduz com **`afplay`** — substitui `N` pelo índice (ex. microfone `1`):

   `npm run inear:mac:capture-cmd -- --listen 6 --index N`  

   Ouves a gravação **logo a seguir** (não é streaming em tempo real). Se ouvires o esperado, o `ffmpeg` está a ler esse dispositivo.

2. **Com o desktop a correr:** no terminal onde arrancaste o Electron, não deve aparecer em loop `captura: poucos dados do ffmpeg`.

3. **No telemóvel (músico):** abre o retorno WebSocket — o aviso verde indica que o servidor recebe PCM (`GET /api/session` → `pcAudioCaptureReceiving`).

4. **Ajuda de linha de comando:** `npm run inear:mac:capture-cmd -- --help`

## Wi‑Fi 2,4 GHz e 5 GHz

O servidor envia **sempre** blocos de **128 amostras/canal** (~2,7 ms a 48 kHz) por UDP/WebSocket para minimizar atraso. O perfil **Rede** no painel (`wifi_2_4` / `wifi_5` / `auto`) mantém-se como referência operacional; em **2,4 GHz** convém AP menos congestionado e telefones mais perto do AP.

Recomendação operacional: roteador **5 GHz** dedicado ao show, servidor com **Ethernet** ao AP, telefones em **modo avião + só Wi‑Fi** quando possível.

## Cliente UDP de teste (Node)

Com o **desktop a correr** (`npm run dev`). **Não precisas de colar token**: sem `--token`, o receptor faz login como `musician1` / `musician1` (ou `INEAR_LOGIN_USER` / `INEAR_LOGIN_PASS`).

```bash
# ouvir no Mac (precisa de ffplay: brew install ffmpeg)
npm run receiver -- --play

# só métricas no terminal, 60s
npm run receiver -- --seconds 60

# servidor noutra máquina
INEAR_HTTP=http://192.168.x.x:3847 npm run receiver -- --play

# JWT manual continua a funcionar
npm run receiver -- --token "<JWT>" --play
```

O registo UDP usa o **mesmo host** que `INEAR_HTTP`. Com **`--play`**, o PCM vai para o **ffplay** se existir; senão usa **ffmpeg** para mandar o som aos altifalantes (macOS: CoreAudio; Linux: Pulse). Procura em `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` e no PATH. **`INEAR_FFMPEG`** / **`INEAR_FFPLAY`** = caminho absoluto se precisares. Telemetria a cada 5s; por defeito **120s** (`--seconds 30` para menos).

## App móvel (Expo Go)

```bash
npm run dev:mobile
```

1. Suba o desktop: `npm run dev` (API em `:3847`).
2. Ajuste a URL da API no app (ou `DEFAULT_API` em `apps/mobile/App.tsx`) para `http://<IP_LAN_DO_PC>:3847`. Emulador Android: `http://10.0.2.2:3847`.
3. Escaneie o QR no **Expo Go** (mesma rede Wi‑Fi).

O **Expo Go** não carrega módulos nativos como `react-native-udp`. Após o login, o app abre um **WebView** com o mesmo painel web do desktop (**Vite**, porta **5173** na mesma máquina que a API :3847), com sessão passada na URL — mantém `npm run dev` a correr (Vite + Electron). Para **UDP** na LAN, use `npm run receiver` no computador.

## Estrutura

- `apps/desktop-server` — Electron (`main-process/`) + UI admin/músico + motor de mix + persistência do showfile
- `packages/protocol` — wire frame UDP, showfile, mixer
- `apps/mobile` — Expo (Expo Go): login + showfile na LAN + teste encode/decode do protocolo
- `tools/udp-receiver.cjs` — receptor Node para POC

## Testes

```bash
npm test
npm run typecheck
```
