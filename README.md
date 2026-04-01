# Great.Cards MCP Server

MCP (Model Context Protocol) server that exposes Great.Cards credit card recommendation tools for AI agents and bots.

## Tools

| Tool | Description |
|------|-------------|
| `recommend_cards` | Personalized card recommendations based on spending profile. Returns top cards ranked by net annual savings. |
| `get_card_details` | Full card details — fees, benefits, rewards, eligibility criteria. |
| `list_cards` | Browse cards with filters (category, fees, network, bank). |
| `compare_cards` | Side-by-side comparison of 2-3 cards. |
| `check_eligibility` | Check eligible cards by pincode, income, and employment status. |

## Setup

```bash
npm install
cp .env.example .env
# Add your PARTNER_API_KEY to .env
```

## Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PARTNER_API_KEY` | Yes | API key from BankKaro |
| `PARTNER_TOKEN_URL` | No | Token endpoint (default: UAT) |
| `PARTNER_BASE_URL` | No | API base URL (default: UAT) |
| `CACHE_TTL_HOURS` | No | Cache lifetime in hours (default: 168 = 7 days) |

## Connect to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "great-cards": {
      "command": "node",
      "args": ["C:/Users/Mohsin/Downloads/greatcards-mcp-server/dist/index.js"],
      "env": {
        "PARTNER_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Connect to any MCP client

The server uses stdio transport. Point any MCP-compatible client at:
```
node dist/index.js
```

With environment variable `PARTNER_API_KEY` set.
