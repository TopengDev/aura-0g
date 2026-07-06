// ArenaReputation event ABI for the indexer (game layer). Mirrors the events in contracts/src/ArenaReputation.sol.
// Auto-extracted from the Foundry artifact (events only; that is all Ponder needs to decode logs).
// Kept `as const` so Ponder can infer the event args (matches the other indexer/abis/*.ts).
export const ArenaReputationAbi = [
  {
    "type": "event",
    "name": "AnchorerUpdated",
    "inputs": [
      {
        "name": "anchorer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SeasonAnchored",
    "inputs": [
      {
        "name": "seasonEpoch",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "ladderRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  }
] as const;
