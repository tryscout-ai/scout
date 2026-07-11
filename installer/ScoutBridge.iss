#define MyAppName "Scout Bridge"
#define MyAppVersion "0.2.8"
#define MyAppPublisher "Scout"

[Setup]
AppId={{11111111-2222-3333-4444-555555555555}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Scout Bridge
DefaultGroupName=Scout Bridge
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=ScoutBridgeSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Files]
Source: "..\deploy\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\deploy\bridge\*"; DestDir: "{app}\bridge"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Scout Bridge"; Filename: "{app}\node\node.exe"; Parameters: """{app}\bridge\dist\index.js"""
Name: "{commondesktop}\Scout Bridge"; Filename: "{app}\node\node.exe"; Parameters: """{app}\bridge\dist\index.js"""

[Run]
Filename: "{app}\node\node.exe"; Parameters: """{app}\bridge\dist\index.js"""; WorkingDir: "{app}\bridge"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"