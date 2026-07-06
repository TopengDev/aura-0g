// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentRegistry} from "./AgentRegistry.sol";

/// @title AuraCatalogMainnet - the EMBEDDED, byte-faithful snapshot of the live testnet catalog.
/// @notice GENERATED (do not hand-edit) by scripts/gen_catalog.py from cast getAgent(id) RAW reads
///         against AgentRegistry 0xb5960cc08caa5195095cfb8aa270f122be09ba0a on 0G Galileo
///         testnet (16602). It exists so the MAINNET (16661) cutover can re-mint the catalog with
///         NO cross-chain read (the source registry has no code on mainnet): DeployCutover, under
///         EMBEDDED_CATALOG=1, iterates this array through the SAME AuraMigration.remint path with the
///         SAME require(nextAgentId()==id) id-preservation invariant.
///
///         ALL 30 entries are embedded (id order, index i => agentId i+1) so ids stay CONTIGUOUS and
///         the curated premium agents keep their exact ids (VELLUM..SOLACE = 11..30). The 6 NON-curated
///         entries (test-junk 5,7,8,10 = TESTAGENT/BRAINTEST; external 6,9 = CHILLDAWG) are still minted
///         to preserve ids but are flagged curated=false (surfaced/priced out of the demo economy).
///         Per the diligence ownership verdict, the mainnet deploy consolidates EVERY agent to the
///         deployer (the caller applies the owner override; owners below are reference-only).
///
///         FAITHFULNESS is machine-checked: AuraCatalogForkParity.t.sol forks live testnet and asserts
///         every curated entry equals AgentRegistry.getAgent(id) field-by-field.
library AuraCatalogMainnet {
    uint256 internal constant COUNT = 30;

    function count() internal pure returns (uint256) {
        return COUNT;
    }

    /// @notice The full 30-entry catalog in id order (index i => agentId i+1) as AgentRegistry.Agent
    ///         structs, so it feeds the SAME AuraMigration.remint(inft, owner, a) path. The owner is
    ///         applied by the caller (mainnet deploy overrides ALL to the deployer).
    function agents() internal pure returns (AgentRegistry.Agent[] memory a) {
        a = new AgentRegistry.Agent[](COUNT);
        // id 1  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[0] = AgentRegistry.Agent("NOKTURNE", 0x10551f4da474454d66b2bbafdc57f2eade699c9a8c42133dd66bdbaec395d7ca, "0g://enc-brain-nokturne", 0x882888aa3c03b9bdbeeadb9fdaa13af3813685b68c733fa8c5b507be61307388, 700, 1, 1000);
        // id 2  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[1] = AgentRegistry.Agent("MIRAI", 0x0b1d4b1682acfd892d227a6edc005748aa3cc963b562981c61c11bb5ac6f645f, "0g://enc-brain-mirai", 0x882888aa3c03b9bdbeeadb9fdaa13af3813685b68c733fa8c5b507be61307388, 800, 1, 1000);
        // id 3  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[2] = AgentRegistry.Agent("RISO", 0x5334b9d1a5e43f13f0c91fca4c1f5d516f3ab16c87ac668a259b8796c039a272, "0g://enc-brain-riso", 0x882888aa3c03b9bdbeeadb9fdaa13af3813685b68c733fa8c5b507be61307388, 600, 1, 750);
        // id 4  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[3] = AgentRegistry.Agent("SCRIPTORIUM", 0x85ebe80aa3be5709c568bc7bc74ef6ab279f291c34beac1cce005e4e10377413, "0g://enc-brain-scriptorium", 0x882888aa3c03b9bdbeeadb9fdaa13af3813685b68c733fa8c5b507be61307388, 900, 1, 1200);
        // id 5  (NON-curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[4] = AgentRegistry.Agent("TESTAGENT_039386", 0x6ef45daa29e327ac3841f17f043dc30564f4fe9b16bbf061fb64e0f22733d4c9, "0x43886d95f38327e6ed8138885d41297742952319f5c95f0e5f5b65d5a5c83890", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 750, 1, 1000);
        // id 6  (NON-curated)  owner(testnet)=0x56b4d1d5Aa7C2924742cC6Bf5Ba0728eE65Df28D
        a[5] = AgentRegistry.Agent("CHILLDAWG", 0x50df0a04b728dd4a4fe2e6d70fb72ee0f5f1894b221b686ac31810f8ae31524a, "0xe85d2829a6d1256cbc769ea9db8f7803ac3a6695cf06635d13f50737627b5e56", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 50, 1, 100);
        // id 7  (NON-curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[6] = AgentRegistry.Agent("BRAINTEST_544742", 0xe353d53c7b8572a288e3eb1d00cc4f206bb6360793d71509171d02dc187162f7, "0xb93ae08b383ef16f1c62ff1fb8cf6a6bc846025d98f212e762f8171acb85c0f7", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 8  (NON-curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[7] = AgentRegistry.Agent("BRAINTEST_972386", 0xb92272b865593d90e1473815cc95403d9d41990edddc29531615cae62825b2bf, "0x595b2cbece076132fab4e73493eaf314bf72993f77936ede92e0c3dd36d7b01e", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 9  (NON-curated)  owner(testnet)=0x56b4d1d5Aa7C2924742cC6Bf5Ba0728eE65Df28D
        a[8] = AgentRegistry.Agent("CHILLDAWG", 0x50df0a04b728dd4a4fe2e6d70fb72ee0f5f1894b221b686ac31810f8ae31524a, "0xd43af0590df43ff662fb3af75dacea2b5322610119838d8b819c8958d4a35bb2", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 50, 1, 80);
        // id 10  (NON-curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[9] = AgentRegistry.Agent("TESTAGENT_798817", 0x90a177dec94a37f3776544b9236228853f12a2b7cdabd2d3b9327601b68812a2, "0xc4274b9f08af36a06fe20b2f9b20746991c53a23e099f9b568dcc5b2003957d1", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 750, 1, 1000);
        // id 11  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[10] = AgentRegistry.Agent("VELLUM", 0x77fca1c56f4c6750e502986863014e8cb41f032c382c9f0c16e3411dfa17336e, "0x97ffda045b4bcd4fdfb5b854acb46aaee67b4aa017eabd82ebc97cedd8a31401", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1500, 1, 1000);
        // id 12  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[11] = AgentRegistry.Agent("VANTABLOOM", 0xea68c34d9cb81701ceb52c27ca0587fa9831ae68a30b45bb456411b487ba6097, "0xa3ec962728014cac20c61438586732a95cbfaf96953754b7237e0315a784abfa", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1500, 1, 1000);
        // id 13  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[12] = AgentRegistry.Agent("UKIYO", 0x7f8041b6efadcd0c1ab2700e72b255eb3cada7e292d1830238ed1a1722ade116, "0xfe5dfefe4f1baa4991c37729e2fdaeed4cc058233fa4b464399e4a2efa418f18", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1200, 1, 1000);
        // id 14  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[13] = AgentRegistry.Agent("TESSEN", 0x0de7a957bbad60578f16647ac510c9c7faaeffb0fc590826f76d101c5813a14e, "0x18151a7ca06992c4719b0752b9c82312b506fa06c068a29eb8c09539a0f47ed7", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1200, 1, 1000);
        // id 15  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[14] = AgentRegistry.Agent("CALDERA", 0x23ed25b3582853a917a224eb296df7b19c85132f3378d7f97c26ff393968a08e, "0x86c9b84e437bcadca5a5db577da08ee1fd45ab08fdfbc8982aaa298edfa51a84", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1200, 1, 1000);
        // id 16  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[15] = AgentRegistry.Agent("VERVAINE", 0xb6949fe6cf4f1b64bfcfbea12d61ff87523c6f87869f36ad627f357dfbf195ac, "0x2246c1810e4254e467fb04d9637c828035cd83c14527a80120e77fa4eefa005e", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 1200, 1, 1000);
        // id 17  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[16] = AgentRegistry.Agent("SUMI", 0xf99691e551e94932b790a16c16f746fb38646211181b304acfe743249259e312, "0xb769dccf5fd7f93fe7c2decfaed67402eeaa8a26eb0a688ecbfe87758d5d72e6", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 18  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[17] = AgentRegistry.Agent("AZULENE", 0x5f8253d22b817c14797d45cc7796f6c3e843662a45a2f8183023c50be866e2b0, "0xe5189c891ed4da4ac5da3e30da1d0e6c88323656b83aa1268ff9affb49e64042", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 19  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[18] = AgentRegistry.Agent("KONSTRUKT", 0x387e9ede88281e497cefadf52f44e237f6737939f03a9b41247b6bd00f2fee42, "0x0fdb0bc866e1d91641b737098c05b30a3058ef051b0445200959f0d103bbc366", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 20  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[19] = AgentRegistry.Agent("BITSY", 0x1bb0d976d6e6f840c78ed5b0c71d8a9ebf3e25a83e5dcce6e71611f10a51f466, "0xc73fde1d7f7abf16d557bba0da9fec84df998e3e99a57e6a901c4b82ee824da6", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 21  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[20] = AgentRegistry.Agent("ARCANUM", 0x2ca605e802210145f7e50ab600a879379f9b643e97b9209f1c47f7072b438ab1, "0x876305a566a38ad8e14ae60c70eff20e665ec6b02f217114fa324d6cb98edd74", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 22  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[21] = AgentRegistry.Agent("RIOT", 0x4cdd610d29fa96a96a8cc13045da27ee8aec76ac336762fb82abe646b1c27773, "0x16c60170c6ac690df86b2daf6e9ebfd1dacddcd451557ee4c5ba4eac91456172", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 900, 1, 1000);
        // id 23  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[22] = AgentRegistry.Agent("AQUELLE", 0xecbba0ec3002f3528fa13d784e946219ee544da6dbc8fbc599d581d72efeeb4a, "0xf083f72c57a1475cc6ccc3c17e5f9d5d2a72481d6a5de88b7ea2b83d1562ba6d", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 24  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[23] = AgentRegistry.Agent("B\xc3\x89TON", 0xc6328d7b90af5ea3cad60ce5b9a2756f6f52c9fe6fa62047bc5724b2b436f889, "0xa80a1b70e696af10c71b8d4bf09ca54c3f57d0d6b6639d9a03146da4d31b6605", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 25  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[24] = AgentRegistry.Agent("RETROGRADE", 0x88325a722541d60ad794f636a256ddc399abee158b495a907bb01c66d7fba800, "0x807d52ebb2e74a86f88095d640ddf66741d9072b62e33323aad9abbee4ea4498", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 26  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[25] = AgentRegistry.Agent("MORPH", 0x20f85415755b5a50afae3b958f274eec61bdc7df3e6382fb09b9b2ee6d2e7d7a, "0x80cbf50f5c3071dde35066f99f3c53920d3788d7fc3f7b791c01eb84905f456b", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 27  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[26] = AgentRegistry.Agent("FAIENCE", 0x2dab32710143171e89a4247e3537da2f9a9622eebacfbbfae1f8c7633086d25a, "0x889c852fa54cbaaa655178e5208f179a1b1591efcf8b8bbe9d223519639a1493", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 28  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[27] = AgentRegistry.Agent("SKEIN", 0x262f1d2f592723fc070f70afaaff2551b5850dc68546496d39aa2168a5019c5e, "0xf996ddae4bd0221b4655dfe0bc42f7e58db3a0cca196df4b174e62f3da1234d7", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 29  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[28] = AgentRegistry.Agent("MIRAGE", 0xc8506765c907698a3316aa8adb06f9fecf01eb74f2a3ab405190c6bb216e5833, "0x35d7c733c4ef0d9fa9c2aed06bb8239d61d4f02a7422499f220182917aab0b91", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
        // id 30  (curated)  owner(testnet)=0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540
        a[29] = AgentRegistry.Agent("SOLACE", 0xf6bad27e3d11d80590b8200b6e68b791d603621b9886f12a5a16f39d7bfd92fd, "0xcc2153a3f3be89a27d72cd68c2b0aa064522e711996dc4dabf980fc908f7e4c6", 0xe97eddfb7a63dbc3261245c8df93d655abeb20bcb9a446f5f5669e133a415091, 700, 1, 1000);
    }

    /// @notice curated[i] == true for the demo set (ids 1-4, 11-30); false for the 6 non-curated
    ///         (ids 5,6,7,8,9,10). Used to gate summon-pricing to the curated agents on the mainnet cutover.
    function curated() internal pure returns (bool[] memory c) {
        c = new bool[](COUNT);
        for (uint256 i = 0; i < COUNT; i++) {
            c[i] = true;
        }
        c[4] = false; // id 5
        c[5] = false; // id 6
        c[6] = false; // id 7
        c[7] = false; // id 8
        c[8] = false; // id 9
        c[9] = false; // id 10
    }

    /// @notice The ORIGINAL testnet owners (reference only; NOT used to mint - the mainnet cutover
    ///         consolidates ALL agents to the deployer per the diligence Q2 ownership verdict).
    function testnetOwners() internal pure returns (address[] memory o) {
        o = new address[](COUNT);
        o[0] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 1
        o[1] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 2
        o[2] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 3
        o[3] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 4
        o[4] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 5
        o[5] = 0x56b4d1d5Aa7C2924742cC6Bf5Ba0728eE65Df28D; // id 6
        o[6] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 7
        o[7] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 8
        o[8] = 0x56b4d1d5Aa7C2924742cC6Bf5Ba0728eE65Df28D; // id 9
        o[9] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 10
        o[10] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 11
        o[11] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 12
        o[12] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 13
        o[13] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 14
        o[14] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 15
        o[15] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 16
        o[16] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 17
        o[17] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 18
        o[18] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 19
        o[19] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 20
        o[20] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 21
        o[21] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 22
        o[22] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 23
        o[23] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 24
        o[24] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 25
        o[25] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 26
        o[26] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 27
        o[27] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 28
        o[28] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 29
        o[29] = 0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540; // id 30
    }
}
