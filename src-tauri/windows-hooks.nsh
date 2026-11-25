; Point the PDF file class (registered by Tauri's file association as "PDF") at our own file icon.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\PDF\DefaultIcon" "" "$INSTDIR\pdf-file.ico,0"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
