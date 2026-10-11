; Register an optional PDF handler for this user. Never replace the PDF default
; or Windows' protected UserChoice. Uninstall removes only our registrations.
!macro customInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Multi-Viewer"
  ; Keep old Windows UserChoice references working after the executable rename.
  DeleteRegKey HKCU "Software\Classes\Applications\Multi-Viewer.exe\SupportedTypes"
  WriteRegStr HKCU "Software\Classes\Applications\Multi-Viewer.exe" "FriendlyAppName" "OmniView"
  WriteRegStr HKCU "Software\Classes\Applications\Multi-Viewer.exe\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\MultiViewer.PDF" "" "PDF document"
  WriteRegStr HKCU "Software\Classes\MultiViewer.PDF\Application" "ApplicationName" "OmniView"
  WriteRegStr HKCU "Software\Classes\MultiViewer.PDF\Application" "ApplicationDescription" "OmniView — Any File. One Viewer."
  WriteRegStr HKCU "Software\Classes\MultiViewer.PDF\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr HKCU "Software\Classes\MultiViewer.PDF\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "MultiViewer.PDF" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "OmniView"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  WriteRegStr HKCU "Software\MultiViewer\Capabilities" "ApplicationName" "OmniView"
  WriteRegStr HKCU "Software\MultiViewer\Capabilities" "ApplicationDescription" "OmniView — Any File. One Viewer."
  WriteRegStr HKCU "Software\MultiViewer\Capabilities\FileAssociations" ".pdf" "MultiViewer.PDF"
  WriteRegStr HKCU "Software\RegisteredApplications" "OmniView" "Software\MultiViewer\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "MultiViewer.PDF"
  DeleteRegKey HKCU "Software\Classes\MultiViewer.PDF"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey HKCU "Software\Classes\Applications\Multi-Viewer.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "OmniView"
  DeleteRegKey HKCU "Software\MultiViewer\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\MultiViewer"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
