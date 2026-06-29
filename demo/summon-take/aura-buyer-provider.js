// AURA demo buyer wallet — EIP-6963 injected provider for the Live Summon recording.
// Relays eth_sendTransaction to the localhost buyer-signer (the key lives THERE, never in the browser);
// proxies reads to the Galileo RPC. Injected into the page at recording time; wagmi/RainbowKit pick it up
// via the EIP-6963 announce. Buyer ADDRESS is public; no secret in this file.
(() => {
  const BUYER = "0x6072C05AdD8Eb43f5aE7Dc7817889ab8AE64d8Fa";
  const RPC = "https://evmrpc-testnet.0g.ai";
  const SIGNER = "http://127.0.0.1:8799";
  const CHAIN_HEX = "0x40da"; // 16602
  let rpcId = 1;
  const listeners = {};

  async function rpc(method, params) {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params: params || [] }),
    });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message || "rpc error"), { code: j.error.code || -32000 });
    return j.result;
  }

  const provider = {
    isAuraDemoBuyer: true,
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [BUYER];
        case "eth_chainId":
          return CHAIN_HEX;
        case "net_version":
          return "16602";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "wallet_getPermissions":
        case "wallet_requestPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "eth_sendTransaction": {
          const tx = (params && params[0]) || {};
          const r = await fetch(SIGNER + "/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: tx.to, data: tx.data, value: tx.value, gas: tx.gas }),
          });
          const j = await r.json();
          if (!r.ok || j.error) throw new Error(j.error || "buyer-signer error");
          return j.hash;
        }
        default:
          return rpc(method, params); // proxy all reads to the chain
      }
    },
    on(event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
      return provider;
    },
    removeListener(event, cb) {
      if (listeners[event]) listeners[event] = listeners[event].filter((f) => f !== cb);
      return provider;
    },
    async enable() {
      return [BUYER];
    },
  };

  const info = {
    uuid: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "aura-demo-buyer-0000",
    name: "AURA Demo Buyer",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzExMSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNCIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiPkE8L3RleHQ+PC9zdmc+",
    rdns: "demo.aura.buyer",
  };
  function announce() {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  try {
    if (!window.ethereum) window.ethereum = provider;
  } catch (e) {
    /* read-only window.ethereum */
  }
  setTimeout(() => {
    (listeners["connect"] || []).forEach((cb) => {
      try {
        cb({ chainId: CHAIN_HEX });
      } catch (e) {
        /* noop */
      }
    });
  }, 0);
  window.__auraBuyerProvider = provider;
  console.log("[aura-demo-buyer] EIP-6963 provider announced for", BUYER);
})();
