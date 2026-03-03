# Chrome Web Store Listing

## Extension Name
Clawku - AI Browser Control

## Short Description (132 characters max)
Let your AI assistant control your browser - navigate, click, fill forms, and take screenshots through natural conversation.

## Detailed Description (16,000 characters max)

**Control Your Browser with AI - Just Chat!**

Clawku connects your browser to your AI assistant, letting you automate browsing tasks through natural conversation. Just tell your AI what to do, and watch it happen.

**What Can Your AI Do?**

- Navigate to any website
- Click buttons and links
- Fill out forms automatically
- Take screenshots of pages
- Read and extract page content
- Scroll through pages
- Open and close tabs

**How It Works**

1. Install the extension
2. Pair with your Clawku account using a simple 6-digit code
3. Start chatting with your AI on WhatsApp, Telegram, Discord, or any connected channel
4. Say things like "Go to Gmail and check my inbox" or "Take a screenshot of this page"

**Example Commands**

- "Open YouTube and search for cooking tutorials"
- "Fill out this contact form with my details"
- "Take a screenshot of the current page"
- "Click the Submit button"
- "Scroll down to see more"

**Privacy & Security**

- Your browser activity stays between you and your AI
- Secure WebSocket connection to Clawku servers
- No browsing data is stored on our servers
- You control when the AI can access your browser
- Disconnect anytime with one click

**Requirements**

- A Clawku account (free at clawku.ai)
- At least one AI persona set up
- Chrome browser (version 88+)

**Support**

Need help? Visit https://clawku.ai/docs or email support@clawku.ai

---

## Category
Productivity

## Language
English

## Privacy Policy URL
https://clawku.ai/privacy

## Website URL
https://clawku.ai

## Support URL
https://clawku.ai/docs

---

## Screenshots Needed (1280x800 or 640x400)

1. **Popup paired state** - Shows extension connected to persona
2. **Popup pairing** - Shows 6-digit code entry
3. **Browser action** - AI navigating to a website
4. **Screenshot capture** - AI taking a screenshot
5. **Form filling** - AI filling out a form

## Promotional Images Needed

- **Small Promo Tile**: 440x280 px
- **Large Promo Tile**: 1400x560 px (optional but recommended)
- **Marquee**: 1400x560 px (optional)

---

## Justification for Permissions

### tabs
Required to list open tabs, create new tabs, navigate to URLs, and capture screenshots of the active tab.

### activeTab
Required to execute actions (click, type, scroll) on the currently active tab when requested by the user's AI assistant.

### scripting
Required to inject content scripts that perform browser automation actions like clicking elements, filling forms, and reading page content.

### storage
Required to store the user's pairing token and connection settings locally in the browser.

### host_permissions: <all_urls>
Required because users may ask their AI to interact with any website. The extension needs to be able to execute automation scripts on any page the user visits.
