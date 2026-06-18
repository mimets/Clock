!macro customCheckAppRunning
  nsExec::Exec 'taskkill /f /im "Stage Tracker.exe"'
  Sleep 1000
!macroend

!macro customUnInstallCheck
  Return
!macroend
