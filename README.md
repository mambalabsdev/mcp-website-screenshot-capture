# Website Screenshot Capture MCP Server

[![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-website-screenshot-capture/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-website-screenshot-capture) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-website-screenshot-capture%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-website-screenshot-capture&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-website-screenshot-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-website-screenshot-capture) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-website-screenshot-capture)](https://www.npmjs.com/package/@mambalabsdev/mcp-website-screenshot-capture) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-website-screenshot-capture)](https://github.com/mambalabsdev/mcp-website-screenshot-capture/blob/main/LICENSE)

An MCP server for the Mamba Labs Website Screenshot Capture actor on Apify. Turn a list of URLs into screenshot links, one row per page.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Give page URLs. Each page opens in a Chromium browser, waits for the load state you pick, and is saved as a PNG or JPEG image. You get one row per page with the image link, the final URL after redirects, the HTTP status, the page title, and the image size. Full page captures run up to 16,000 pixels tall.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-website-screenshot-capture": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-website-screenshot-capture"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `capture_website_screenshots` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Take full page screenshots of these three competitor home pages."
- "Capture stripe.com at a 390 pixel mobile width as a JPEG."
- "Screenshot each landing page in this list and tell me which ones return an error."

## Tool

`capture_website_screenshots`. One tool. Example arguments:

```json
{
  "urls": [
    "https://example.com"
  ],
  "full_page": true
}
```

## Inputs

Every buyer facing input of the actor. Omitted inputs take the actor's own defaults.

| Input | Type | Required | Description |
|---|---|---|---|
| `urls` | array | no | Pages to capture, each starting with http:// or https://. A bare domain such as example.com gets https:// added. From Clay, put the column inside a one item list. |
| `full_page` | boolean | no | yes captures the whole scrollable page, up to 16,000 pixels tall. no (default) captures the visible window only. |
| `viewport_width` | number | no | Browser window width, 320 to 3840. Default 1280. |
| `viewport_height` | number | no | Browser window height, 240 to 2160. Default 800. With Full page on, the image is as tall as the page. |
| `format` | string | no | png (default) or jpeg. JPEG files are smaller. |
| `jpeg_quality` | number | no | 1 to 100, used for jpeg only. Default 80. |
| `wait_until` | string | no | When the page counts as loaded. load (default): the page and its images loaded. domcontentloaded: the HTML is parsed, faster. networkidle: no network traffic for 0.5 s, best for pages that load content late. |
| `delay_ms` | number | no | Extra wait after the page loads and before the capture, 0 to 20000. Default 0. |
| `scroll_to_bottom` | boolean | no | yes scrolls down the page before the capture so images that load on scroll appear, then returns to the top. Default no. |
| `hide_selectors` | array | no | Elements to hide before the capture, for example a cookie banner or a chat widget: #cookie-banner, .chat-widget. |
| `block_trackers` | boolean | no | yes (default) skips analytics, ad, and session replay scripts and video or audio files, which draw nothing you need in the image and make pages slower. no loads everything, so ads appear. |
| `timeout_seconds` | number | no | Longest wait for one page to load, 10 to 120. Default 60. A page still loading at this point is captured as it stands and marked partial. |
| `max_charge_usd` | string | no | Optional. The run stops before a charge that would pass this amount. Summary rows are always returned. |
| `proxy_mode` | string | no | auto (default): pages load through the Apify proxy pool. none: pages load straight from the Apify server. A reliability setting only; it does not change what you pay. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `screenshot`, one page captured as a window sized image | $0.014 | $0.0133 | $0.0126 | $0.0119 |
| `full-page-screenshot`, one page captured top to bottom, when Full page is on | $0.023 | $0.02185 | $0.0207 | $0.01955 |
| `apify-actor-start`, per run start | $0.013 | $0.013 | $0.013 | $0.013 |

Pages that refuse the browser, pages that answer an HTTP error, unusable URLs, and refused input are free. Mamba Labs pays the platform costs of the run, Apify proxy traffic included.

## Full actor documentation

[apify.com/mambalabs/website-screenshot-capture](https://apify.com/mambalabs/website-screenshot-capture)

## License

MIT. See [LICENSE](LICENSE).
