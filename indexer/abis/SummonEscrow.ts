// SummonEscrow (demand-pull commissioning) event ABI for the indexer. Mirrors the events in
// contracts/src/SummonEscrow.sol (and the server's human-readable SUMMON_ABI in
// server/src/aura/contracts.ts). Only the events are needed for log indexing; `Fulfilled` is the one the
// indexer credits (ownerCut -> the agent's current owner = "income follows the agent"). Kept `as const` so
// Ponder can infer the event args (matches the other indexer/abis/*.ts).
export const SummonEscrowAbi = [
  {
    "type": "event",
    "name": "SummonPriceSet",
    "inputs": [
      { "name": "agentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "owner", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "price", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Summoned",
    "inputs": [
      { "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "agentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "buyer", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "fee", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "deadline", "type": "uint64", "indexed": false, "internalType": "uint64" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Fulfilled",
    "inputs": [
      { "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "agentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "buyer", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "tokenId", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "agentOwner", "type": "address", "indexed": false, "internalType": "address" },
      { "name": "ownerCut", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "platformFee", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refunded",
    "inputs": [
      { "name": "requestId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "buyer", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "fee", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawal",
    "inputs": [
      { "name": "who", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
] as const;
