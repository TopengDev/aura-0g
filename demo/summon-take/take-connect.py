#!/usr/bin/env python3
# Take step 1: navigate the agent page (pre-load the SSR), inject the EIP-6963 buyer provider, open the
# RainbowKit modal, click the "AURA Demo Buyer" wallet, verify connected. Drives via qutebrowser CDP.
import asyncio, json, urllib.request, sys, os
import websockets

PROV = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "aura-buyer-provider.js")).read()

def tab():
    tabs = json.load(urllib.request.urlopen("http://localhost:2262/json/list"))
    pages = [t for t in tabs if t.get("type") == "page" and "localhost:3000" in t.get("url", "")]
    if not pages:
        pages = [t for t in tabs if t.get("type") == "page"]
    return pages[0]["id"]

async def main():
    tid = tab()
    async with websockets.connect(f"ws://localhost:2262/devtools/page/{tid}", max_size=None) as ws:
        i = 0
        async def cmd(method, params=None):
            nonlocal i; i += 1; mid = i
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == mid: return m
        async def ev(expr):
            r = await cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
            return r.get("result", {}).get("result", {}).get("value")

        # 1. fresh navigate + pre-load (5.8s SSR + hydration)
        await cmd("Page.navigate", {"url": "http://localhost:3000/agents/1"})
        print("navigated; pre-loading…"); await asyncio.sleep(11)
        # 2. inject the provider (EIP-6963 announce)
        await ev(PROV)
        print("provider injected:", await ev("!!window.__auraBuyerProvider"))
        await asyncio.sleep(1)
        # 3. open the connect modal — click a 'Connect wallet' button
        clicked = await ev("""(() => {
          const b = [...document.querySelectorAll('button')].find(b => /connect wallet/i.test(b.textContent||''));
          if (b) { b.click(); return true; } return false; })()""")
        print("clicked Connect wallet:", clicked); await asyncio.sleep(1.5)
        # 4. click the AURA Demo Buyer wallet option (RainbowKit lists EIP-6963 providers)
        picked = await ev("""(() => {
          const els = [...document.querySelectorAll('button, [role=button]')];
          const b = els.find(b => /aura demo buyer/i.test(b.textContent||''));
          if (b) { b.click(); return true; } return false; })()""")
        print("picked AURA Demo Buyer:", picked); await asyncio.sleep(2.5)
        # 5. close the modal if still open (press Escape) + verify connected
        await cmd("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape"})
        await cmd("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape"})
        await asyncio.sleep(1)
        body = await ev("document.body.innerText")
        connected = ("Summon for" in (body or "")) or ("0x6072" in (body or "")) or ("0x60" in (body or "").lower())
        print("=== connected (Summon button visible):", "Summon for" in (body or ""))
        # show the summon-area text
        import re
        for kw in ["Summon for", "Live commission", "Not summonable", "Connect wallet"]:
            if kw.lower() in (body or "").lower(): print("  panel shows:", kw)

asyncio.run(main())
