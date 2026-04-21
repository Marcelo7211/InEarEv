; Apaga dados da instalação anterior antes de copiar ficheiros (reinstalação limpa).
; Deve coincidir com app.setName('inEar Desktop') em main.cjs.
!macro customInit
  SetShellVarContext current
  IfFileExists "$APPDATA\inEar Desktop" 0 +2
    RMDir /r "$APPDATA\inEar Desktop"
!macroend
