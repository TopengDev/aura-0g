// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// Deploys the 3 contracts + seeds 1 agent + mints 1 output (the e2e on-chain proof).
/// Usage (Galileo): forge script script/Deploy.s.sol --rpc-url galileo --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_UINT");
        address me = vm.addr(pk);
        vm.startBroadcast(pk);

        AgentRegistry reg = new AgentRegistry();
        OutputNFT outNft = new OutputNFT(address(reg));
        Marketplace mkt = new Marketplace(address(outNft), me, 250);

        // Seed NOKTURNE agent + mint one provenance-stamped output.
        uint256 agentId = reg.mintAgent(
            me, "NOKTURNE",
            keccak256("style-dna-nokturne"),
            "0g://enc-brain-root-placeholder",
            keccak256("model:qwen-image-edit-2511"),
            700
        );
        uint256 tokenId = outNft.mintOutput(
            me, agentId,
            "0g://image-root-placeholder",
            keccak256("provenance"),
            keccak256("tee-attestation"),
            42
        );

        vm.stopBroadcast();

        (address recv, uint256 amt) = outNft.royaltyInfo(tokenId, 1 ether);
        console.log("AgentRegistry:", address(reg));
        console.log("OutputNFT    :", address(outNft));
        console.log("Marketplace  :", address(mkt));
        console.log("agentId      :", agentId);
        console.log("outputTokenId:", tokenId);
        console.log("royalty recv :", recv);
        console.log("royalty amt(1e18 sale):", amt);
    }
}
