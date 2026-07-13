!macro customInit
  ; Forcefully kill the process using native Windows command
  ExecWait "taskkill /F /IM Dinky.exe"
  Sleep 1000
!macroend

!macro checkAppRunning
  ; Double check and kill again using native Windows command
  ; (NB: 'checkAppRunning' isn't a standard electron-builder hook name,
  ;  so this macro currently isn't invoked from anywhere - left in case
  ;  a future hook references it.)
  DetailPrint "Ensuring application is closed..."
  ExecWait "taskkill /F /IM Dinky.exe"
  Sleep 500
!macroend

!macro customInstall
  ; Explicitly (re-)create the Start menu shortcut on every install,
  ; including silent auto-updates from electron-updater.
  ;
  ; Problem: when electron-updater runs the new NSIS installer silently
  ; to apply an update, it first runs the OLD uninstaller (which removes
  ; the Start menu shortcut and clears the AUMID registration that
  ; pinned-taskbar items reference). The new installer should re-create
  ; the shortcut, but with perMachine=true that step can be skipped if
  ; elevation isn't applied to the silent run - leaving Dinky.exe in
  ; place but with no Start menu entry and broken pinned items.
  ;
  ; CreateShortCut overwrites any existing .lnk, so calling this on a
  ; first install just rewrites the shortcut electron-builder's default
  ; flow already created.
  SetShellVarContext all
  CreateShortCut "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
!macroend
