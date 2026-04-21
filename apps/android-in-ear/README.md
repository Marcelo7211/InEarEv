# inEar — Android nativo (Kotlin)

Cliente Android para músicos e admins do **inEarApp**: login HTTP, showfile, mixer de retorno (sends, mutes, EQ), transporte de áudio **UDP** (porta 9877 reg + 9876 frames INE1) com **fallback WebSocket** `/api/stream/audio`, e painel admin em **WebView** (Vite `http://<host>:5173` com query `inear_token` / `inear_role`, igual ao app React Native).

## Requisitos

- **JDK 17–24** (recomendado 17 ou 21). JDK 25 pode falhar com o Android Gradle Plugin até haver suporte oficial.
- **Android SDK** (Android Studio ou cmdline-tools). Cria `local.properties` na raiz deste módulo:

```properties
sdk.dir=/caminho/para/Android/sdk
```

(Em macOS costuma ser `~/Library/Android/sdk`.)

## Compilar

```bash
export JAVA_HOME=/caminho/jdk-21   # opcional
./gradlew assembleDebug
```

APK debug: `app/build/outputs/apk/debug/app-debug.apk`

### Release / APK assinado

1. Gera uma keystore (ex.: `keytool -genkeypair -v -keystore inear-release.jks ...`).
2. Copia `keystore.properties.example` → `keystore.properties` e preenche (ficheiros na `.gitignore`).
3. Em `app/build.gradle.kts`, na secção `release`, aponta `signingConfig` para a configuração de release (exemplo comentado no próprio ficheiro).
4. Executa:

```bash
./gradlew assembleRelease
```

APK: `app/build/outputs/apk/release/app-release.apk`  
AAB (Play Store): `./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`

## Áudio

- Descodificação de frames **INE1** (32 bytes cabeçalho + PCM s16le intercalado estéreo) alinhada a [`packages/protocol/src/wireFrame.ts`](../../packages/protocol/src/wireFrame.ts).
- Playback com [`AudioTrack`](https://developer.android.com/reference/android/media/AudioTrack) (`PcmAudioTrackSink`). O plano original citava **Oboe**; o artefacto Maven `com.google.oboe:oboe` não resolveu neste ambiente — podes voltar a integrar Oboe + NDK quando o repositório Maven estiver disponível na tua máquina/CI.

## Rede

- HTTP cleartext permitido para desenvolvimento em LAN (`network_security_config`). Para produção HTTPS, ajusta o manifest e as URLs.

## Testes

```bash
./gradlew testDebugUnitTest
```

Inclui testes JVM do descodificador INE1.
