; The Windows installer is for the person who runs it. Without this it asks "Anyone who uses this computer" or "Only
; for me", and the first puts the app in Program Files, where every later update needs an administrator's password
; (and stops without a word if there isn't one).
; A copy that was already installed for everyone, from an earlier installer, is still updated where it is.
!macro customInstallMode
  ${if} $hasPerMachineInstallation != "1"
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend
