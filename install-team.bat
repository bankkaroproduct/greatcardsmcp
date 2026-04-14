@echo off
echo.
echo  ========================================
echo   Great.Cards MCP Server - Team Install
echo  ========================================
echo.

set CONFIG_DIR=%APPDATA%\Claude
set CONFIG_FILE=%CONFIG_DIR%\claude_desktop_config.json

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

if exist "%CONFIG_FILE%" (
    echo Found existing config at %CONFIG_FILE%
    echo Please add this manually to your mcpServers in that file:
    echo.
    echo   "great-cards": {
    echo     "command": "npx",
    echo     "args": ["-y", "tsx", "C:/path/to/greatcards-mcp-server/src/index.ts"],
    echo     "env": {
    echo       "PARTNER_API_KEY": "YOUR_KEY",
    echo       "PARTNER_TOKEN_URL": "https://uat-platform.bankkaro.com/partner/token",
    echo       "PARTNER_BASE_URL": "https://uat-platform.bankkaro.com/partner"
    echo     }
    echo   }
    echo.
) else (
    echo Creating new config...
    (
    echo {
    echo   "mcpServers": {
    echo     "great-cards": {
    echo       "command": "npx",
    echo       "args": ["-y", "tsx", "C:/path/to/greatcards-mcp-server/src/index.ts"],
    echo       "env": {
    echo         "PARTNER_API_KEY": "YOUR_KEY",
    echo         "PARTNER_TOKEN_URL": "https://uat-platform.bankkaro.com/partner/token",
    echo         "PARTNER_BASE_URL": "https://uat-platform.bankkaro.com/partner"
    echo       }
    echo     }
    echo   }
    echo }
    ) > "%CONFIG_FILE%"
    echo Done! Config written to %CONFIG_FILE%
)

echo.
echo Restart Claude Desktop to activate.
echo.
pause
