// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IAuraRegistry} from "./IAuraRegistry.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title OutputNFT - the artwork NFT (ERC-721 + DYNAMIC EIP-2981 royalty + EIP-712 attestation gate)
/// @notice Each artwork records WHICH agent created it + the 0G provenance (storage root,
///         provenance hash, TEE attestation, seed). The EIP-2981 royaltyInfo() resolves the
///         beneficiary DYNAMICALLY to the creating agent's CURRENT owner - so selling the agent
///         transfers its entire future royalty stream. This is the thesis primitive; it is a
///         HAND-ROLLED royaltyInfo (NOT OZ ERC2981), intentionally, because the receiver must be
///         resolved live at call time, not pinned at mint.
///
///         Minting is ATTESTATION-GATED: the user sends the mint tx themselves, but it only
///         succeeds with a valid backend-attestor EIP-712 signature over the exact mint params.
///         This binds every on-chain artwork to a TEE-attested off-chain generation (consent +
///         provenance), and a per-signature nonce blocks replay. Forged/garbage/replayed -> revert.
contract OutputNFT is ERC721, IERC2981, EIP712 {
    using ECDSA for bytes32;
    using Strings for uint256;
    using MessageHashUtils for bytes32;

    struct Provenance {
        uint256 creatorAgentId; // which agent made it -> routes royalty
        string imageRoot;       // 0G Storage root of the image
        bytes32 provenanceHash; // hash of {agent, model, prompt, seed, attestation, ts}
        bytes32 teeAttestation; // TEE proof of the generating model
        uint256 seed;           // generation seed
    }

    /// @notice The agent registry OutputNFT routes royalties through (ownerOf + royaltyBpsOf). Bound by
    ///         INTERFACE (IAuraRegistry), so it can point at the legacy AgentRegistry OR the real ERC-7857
    ///         AuraINFT - the AuraINFT cutover deploys OutputNFT with this set to the AuraINFT address.
    ///         Immutable, so the registry is fixed at deploy (the reason the cutover REDEPLOYS OutputNFT).
    IAuraRegistry public immutable registry;
    /// @notice The backend signer (TEE-attestation authority). Set at deploy; mints require its sig.
    address public immutable attestor;

    /// @notice Base URL the ERC-721 tokenURI() image field is built on: image = baseImageURI + imageRoot.
    ///         Settable by the attestor (the backend authority that already serves the images) so the origin
    ///         can be repointed without a redeploy. Purely a display concern, never affecting provenance,
    ///         royalty, minting, or the immutable registry pointer.
    string public baseImageURI;

    uint256 public nextTokenId = 1;
    mapping(uint256 => Provenance) private _prov;
    /// @notice Replay guard for the PERMISSIONLESS direct mint (mintOutput). One nonce, one mint.
    mapping(bytes32 => bool) public usedNonce;
    /// @notice SEPARATE replay guard for the escrow SETTLEMENT mint (mintForSettlement). A distinct
    ///         namespace from `usedNonce` so the two mint paths can never cross-consume a nonce - this
    ///         is half of the H-1 fix (the other half is binding the settler into the signed payload).
    mapping(bytes32 => bool) public usedSettlementNonce;

    /// @notice The 0G in-enclave TeeML signer AURA pins for the ON-CHAIN TEE-verified mint (mintOutputVerified).
    ///         It is 0G's REAL published enclave signer (read from 0G's on-chain InferenceServing contract),
    ///         NEVER a self-invented key - e.g. the mainnet z-image-turbo signer 0x592056E413aB456646a50441e52D5BA89527877D.
    ///         Starts address(0) => the on-chain TEE gate is OFF (mintOutputVerified then behaves exactly like
    ///         mintOutput). Owner-updatable via setTeeSigner so a 0G enclave key rotation is a 1-tx fix, not a redeploy.
    address public teeSigner;
    /// @notice Per-token 0G-attested sha256(imageBytes), extracted ON-CHAIN by mintOutputVerified from the exact
    ///         TeeML-signed envelope. Zero for tokens minted via mintOutput or while the TEE gate was off. This is
    ///         the canonical, chain-verified "0G attested THIS artwork's hash" commitment (a keyless /proof can
    ///         curl the image and check sha256(image) == dataHashOf(tokenId)).
    mapping(uint256 => bytes32) private _dataHash;

    // EIP-712 typed struct the backend attestor signs for the DIRECT mint (mintOutput).
    bytes32 private constant MINTAUTH_TYPEHASH = keccak256(
        "MintAuth(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,uint256 nonce)"
    );
    // EIP-712 typed struct for the SETTLEMENT mint (mintForSettlement). DISTINCT from MINTAUTH_TYPEHASH
    // (different digest) AND it binds `settler` = the authorized caller (the SummonEscrow). The attestor
    // signs settler = the escrow address, so only the escrow's own call (msg.sender == settler) settles;
    // a mempool front-runner calling directly has msg.sender != settler -> the sig fails to recover the
    // attestor -> "bad attestation". This is what closes finding H-1.
    bytes32 private constant SETTLEMENT_MINTAUTH_TYPEHASH = keccak256(
        "SettlementMintAuth(address to,address settler,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,uint256 nonce)"
    );

    event OutputMinted(
        uint256 indexed tokenId,
        uint256 indexed creatorAgentId,
        address indexed owner,
        string imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed
    );

    /// @notice Emitted (in addition to OutputMinted) when a Relic is minted through the ON-CHAIN 0G-TEE gate.
    ///         `teeSigner` is the 0G enclave signer the contract recovered; `dataHash` is the sha256(image) 0G
    ///         attested, bound to this token. Absent on mintOutput / gate-off mints.
    event OutputTeeVerified(uint256 indexed tokenId, uint256 indexed creatorAgentId, address teeSigner, bytes32 dataHash);
    /// @notice Emitted when the pinned 0G TEE signer is set or rotated.
    event TeeSignerUpdated(address indexed previous, address indexed current);

    /// @dev Memory bundle for mintOutputVerified's 10 args. The external fn packs its calldata args into this
    ///      struct and hands ONE memory pointer to the internal mint, keeping the mint body under the EVM stack
    ///      limit (10 dynamic-heavy calldata params would otherwise "stack too deep" without via-ir).
    struct VerifiedMintArgs {
        address to;
        uint256 creatorAgentId;
        string imageRoot;
        bytes32 provenanceHash;
        bytes32 teeAttestation;
        uint256 seed;
        bytes32 nonce;
        bytes attestationSig;
        string teeText;
        bytes teeSig;
    }

    constructor(address registryAddr, address attestor_, string memory baseImageURI_)
        ERC721("Zero Cup Output", "ZCOUT")
        EIP712("AuraOutputNFT", "1")
    {
        require(attestor_ != address(0), "attestor required");
        registry = IAuraRegistry(registryAddr);
        attestor = attestor_;
        baseImageURI = baseImageURI_;
    }

    /// @notice Mint a provenance-stamped artwork. Requires a valid attestor EIP-712 signature.
    /// @param to              recipient of the artwork
    /// @param creatorAgentId  the agent that generated it (must exist; its CURRENT owner earns royalty)
    /// @param attestationSig  attestor's EIP-712 signature over MintAuth(...nonce)
    /// @param nonce           single-use nonce binding this signature (replay guard)
    function mintOutput(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig
    ) external returns (uint256 tokenId) {
        require(!usedNonce[nonce], "nonce used");
        // creatorAgentId must reference a real agent (its owner is the dynamic royalty target).
        registry.ownerOf(creatorAgentId); // reverts if agent doesn't exist

        bytes32 structHash = keccak256(
            abi.encode(
                MINTAUTH_TYPEHASH,
                to,
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(attestationSig); // reverts on malformed signature
        require(recovered == attestor, "bad attestation");

        usedNonce[nonce] = true;
        tokenId = nextTokenId++;
        _prov[tokenId] = Provenance(creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed);
        _safeMint(to, tokenId);
        emit OutputMinted(tokenId, creatorAgentId, to, imageRoot, provenanceHash, teeAttestation, seed);
    }

    /// @notice Settlement mint - the ONLY mint path the SummonEscrow uses to settle a paid summon.
    ///         Reachable in practice only by the escrow because the attestation binds `settler` to the
    ///         caller (msg.sender): the backend attestor signs settler = the escrow's address, so a
    ///         mempool front-runner who replays the leaked sig via a DIRECT call has msg.sender != the
    ///         signed settler -> recovered signer != attestor -> revert "bad attestation". It also can NOT
    ///         be replayed through the permissionless `mintOutput` (different EIP-712 type => different
    ///         digest) and consumes a SEPARATE nonce namespace (`usedSettlementNonce`), so the settlement
    ///         nonce can never be pre-consumed out-of-band. Closes finding H-1 (front-run-fulfill griefing)
    ///         WITHOUT touching the legitimate permissionless `mintOutput` direct-mint flow.
    /// @param to              recipient (the summon buyer; the escrow forwards r.buyer)
    /// @param attestationSig  attestor's EIP-712 SettlementMintAuth signature, signed with settler == msg.sender
    function mintForSettlement(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig
    ) external returns (uint256 tokenId) {
        require(!usedSettlementNonce[nonce], "nonce used");
        // creatorAgentId must reference a real agent (its owner is the dynamic royalty target).
        registry.ownerOf(creatorAgentId); // reverts if agent doesn't exist

        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_MINTAUTH_TYPEHASH,
                to,
                msg.sender, // settler: the caller is folded into the signed payload (must be the escrow)
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(attestationSig); // reverts on malformed signature
        require(recovered == attestor, "bad attestation");

        usedSettlementNonce[nonce] = true;
        tokenId = nextTokenId++;
        _prov[tokenId] = Provenance(creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed);
        _safeMint(to, tokenId);
        emit OutputMinted(tokenId, creatorAgentId, to, imageRoot, provenanceHash, teeAttestation, seed);
    }

    /// @notice Set / rotate the pinned 0G TEE signer. Only `attestor` (AURA's platform key, which already
    ///         signs every MintAuth) may call it - the SAME disclosed single-platform trust boundary, no new
    ///         key introduced. Set to address(0) to disable the on-chain TEE gate. Emits TeeSignerUpdated.
    function setTeeSigner(address newSigner) external {
        require(msg.sender == attestor, "not attestor");
        emit TeeSignerUpdated(teeSigner, newSigner);
        teeSigner = newSigner;
    }

    /// @notice Mint a Relic whose provenance is verified ON-CHAIN against 0G's real TeeML enclave signer.
    ///         Additive superset of mintOutput: it runs the IDENTICAL attestor EIP-712 MintAuth gate (consent +
    ///         which agent earns royalty) AND, when `teeSigner` is configured, ecrecovers 0G's enclave signature
    ///         over the exact attested envelope and REVERTS on a forged one, binding this Relic's dataHash to the
    ///         sha256 of the artwork 0G attested. The envelope is 0G's own EIP-191-signed
    ///         `text = "<64hex sha256(request)>:<64hex sha256(image)>"`. Because the attestor's MintAuth already
    ///         signs `teeAttestation`, requiring teeAttestation == keccak256(teeText) makes the attestor's
    ///         signature COVER the exact TEE-signed bytes, so the two gates compose. When teeSigner == 0 the TEE
    ///         gate is skipped (behaves like mintOutput) - the contract ships with the gate off and is flipped on
    ///         with setTeeSigner after a live 0G smoke-test, no redeploy. mintOutput stays as the fallback.
    /// @param teeText  the EXACT ASCII string 0G's enclave signed: "<64hex sha256(reqBody)>:<64hex sha256(image)>"
    /// @param teeSig   0G's 65-byte enclave signature over toEthSignedMessageHash(bytes(teeText)) (EIP-191)
    function mintOutputVerified(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig,
        string calldata teeText,
        bytes calldata teeSig
    ) external returns (uint256 tokenId) {
        // Pack into a memory struct + delegate: collapses the 10 calldata params into one memory pointer so the
        // mint body stays under the EVM stack limit (no via-ir needed). External ABI is unchanged.
        return _mintOutputVerified(
            VerifiedMintArgs(
                to, creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed, nonce, attestationSig, teeText, teeSig
            )
        );
    }

    /// @dev The mintOutputVerified body, operating on a memory bundle (see VerifiedMintArgs). Runs the attestor
    ///      MintAuth gate (same digest as mintOutput) then the on-chain 0G-TEE gate, then mints + stores dataHash.
    function _mintOutputVerified(VerifiedMintArgs memory a) private returns (uint256 tokenId) {
        require(!usedNonce[a.nonce], "nonce used");
        // creatorAgentId must reference a real agent (its owner is the dynamic royalty target).
        registry.ownerOf(a.creatorAgentId); // reverts if agent doesn't exist

        // (A) the existing attestor EIP-712 MintAuth gate - the SAME digest mintOutput uses (consent + agent).
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    MINTAUTH_TYPEHASH,
                    a.to,
                    a.creatorAgentId,
                    keccak256(bytes(a.imageRoot)),
                    a.provenanceHash,
                    a.teeAttestation,
                    a.seed,
                    a.nonce
                )
            );
            require(_hashTypedDataV4(structHash).recover(a.attestationSig) == attestor, "bad attestation");
        }

        // (B) the NEW on-chain 0G-TEE gate (returns 0 while teeSigner == 0; reverts on a forged envelope).
        bytes32 dataHash = _verifyTee(a.teeText, a.teeSig, a.teeAttestation);

        usedNonce[a.nonce] = true;
        tokenId = nextTokenId++;
        _prov[tokenId] = Provenance(a.creatorAgentId, a.imageRoot, a.provenanceHash, a.teeAttestation, a.seed);
        _dataHash[tokenId] = dataHash;
        _safeMint(a.to, tokenId);
        emit OutputMinted(tokenId, a.creatorAgentId, a.to, a.imageRoot, a.provenanceHash, a.teeAttestation, a.seed);
        if (teeSigner != address(0)) emit OutputTeeVerified(tokenId, a.creatorAgentId, teeSigner, dataHash);
    }

    /// @dev The on-chain 0G-TEE gate. Returns the 0G-attested sha256(image) (the dataHash) when `teeSigner` is
    ///      pinned AND teeText/teeSig are a genuine 0G enclave envelope bound to `teeAttestation`; reverts on any
    ///      forgery. Returns bytes32(0) when the gate is off (teeSigner == 0) so mintOutputVerified then mints
    ///      exactly like mintOutput.
    function _verifyTee(string memory teeText, bytes memory teeSig, bytes32 teeAttestation) private view returns (bytes32) {
        address signer = teeSigner;
        if (signer == address(0)) return bytes32(0);
        bytes memory t = bytes(teeText);
        // envelope shape: bare decentralized "<64hex>:<64hex>" (129 bytes, ':' at index 64). Rejects the TeeTLS
        // routing-proof / relay envelopes (a different, longer format) defensively - fail fast.
        require(t.length == 129 && t[64] == bytes1(":"), "bad envelope");
        // bind the stored provenance to the EXACT TEE-signed text (the attestor's MintAuth signs teeAttestation,
        // so this makes the attestor's signature cover teeText - the two gates compose).
        require(keccak256(t) == teeAttestation, "tee text mismatch");
        // THE on-chain check: 0G's enclave signed this exact envelope; reverts on ANY forgery (OZ ECDSA also
        // rejects malleable high-s / bad v). Same primitive AuraINFT already runs live on 0G.
        require(MessageHashUtils.toEthSignedMessageHash(t).recover(teeSig) == signer, "bad TEE attestation");
        // bind THIS Relic to THE attested artwork: dataHash = the sha256(image) slice 0G put in the text.
        return _hexSliceToBytes32(t, 65);
    }

    /// @notice Compute the EIP-712 digest the attestor must sign for a given mint (for backend/tests).
    function authDigest(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                MINTAUTH_TYPEHASH,
                to,
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /// @notice Compute the EIP-712 SettlementMintAuth digest the attestor must sign for an escrow
    ///         settlement (for the backend/tests). `settler` MUST be the escrow address that will call
    ///         mintForSettlement (i.e. the caller's msg.sender at settle time).
    function settlementAuthDigest(
        address to,
        address settler,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_MINTAUTH_TYPEHASH,
                to,
                settler,
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function provenanceOf(uint256 tokenId) external view returns (Provenance memory) {
        require(_ownerOf(tokenId) != address(0), "no such output");
        return _prov[tokenId];
    }

    bytes32 private constant RARITY_TAG = keccak256("AURA-PULL-rarity-v1");

    /// @notice ERC-721 Metadata: fully ON-CHAIN JSON (data:application/json;base64) assembled from the
    ///         token's stored Provenance, with an https image pointing at the existing content-addressed
    ///         image route. The attributes ARE the on-chain provenance (creator agent, image root, provenance
    ///         hash, TEE attestation, seed) plus the provable rarity, so a generic explorer or wallet renders
    ///         "art you can prove" without trusting any AURA server for the metadata itself.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "no such output");
        Provenance storage p = _prov[tokenId];
        string memory image = string(abi.encodePacked(baseImageURI, p.imageRoot));
        string memory attrs = string(
            abi.encodePacked(
                '{"trait_type":"Creator Agent","value":"', p.creatorAgentId.toString(), '"},',
                '{"trait_type":"Image Root","value":"', p.imageRoot, '"},',
                '{"trait_type":"Provenance Hash","value":"', Strings.toHexString(uint256(p.provenanceHash), 32), '"},',
                '{"trait_type":"TEE Attestation","value":"', Strings.toHexString(uint256(p.teeAttestation), 32), '"},',
                '{"trait_type":"Seed","value":"', p.seed.toString(), '"},',
                '{"trait_type":"Rarity","value":"', _rarity(p.seed), '"}'
            )
        );
        string memory json = string(
            abi.encodePacked(
                '{"name":"AURA Relic #', tokenId.toString(),
                '","description":"A provenance-stamped artwork by AURA agent #', p.creatorAgentId.toString(),
                ', with unforgeable on-chain proof of the agent and the TEE-verified model that made it. Art you can prove.",',
                '"image":"', image, '",',
                '"external_url":"https://aura.topengdev.com/outputs/', tokenId.toString(), '",',
                '"attributes":[', attrs, ']}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    /// @notice Repoint the tokenURI image origin (e.g. if the image host moves). Attestor-only and
    ///         display-only, so it can never alter provenance, royalties, or ownership.
    function setBaseImageURI(string calldata baseImageURI_) external {
        require(msg.sender == attestor, "only attestor");
        baseImageURI = baseImageURI_;
    }

    /// @dev Provable rarity, bit-exact with the server deriveRarity() (server/src/aura/gacha.ts): a legacy /
    ///      non-pull decorative seed (< 2^64) reads as "Common" (no migration); a real pull seedRoot (a full
    ///      keccak, uniform in 2^256) is bucketed by roll = uint256(keccak256(abi.encode(bytes32(seed),
    ///      RARITY_TAG))) % 10000 into 80/15/4/1 (Common/Rare/Epic/Legendary). Pure and independently
    ///      recomputable from the on-chain Provenance.seed alone, so the rarity trait is itself rig-evident.
    function _rarity(uint256 seed) internal pure returns (string memory) {
        if (seed < (uint256(1) << 64)) return "Common";
        uint256 roll = uint256(keccak256(abi.encode(bytes32(seed), RARITY_TAG))) % 10000;
        if (roll < 8000) return "Common";
        if (roll < 9500) return "Rare";
        if (roll < 9900) return "Epic";
        return "Legendary";
    }

    /// @notice The 0G-attested sha256(imageBytes) bound to this token by mintOutputVerified (0 if minted via
    ///         mintOutput / with the TEE gate off). A keyless verifier can fetch the image and assert
    ///         sha256(image) == dataHashOf(tokenId) to confirm THIS art is the one 0G's enclave attested.
    function dataHashOf(uint256 tokenId) external view returns (bytes32) {
        require(_ownerOf(tokenId) != address(0), "no such output");
        return _dataHash[tokenId];
    }

    /// @dev Parse 64 ASCII hex chars at offset `off` of `s_` into a bytes32 (the sha256 slice of a TeeML text).
    function _hexSliceToBytes32(bytes memory s_, uint256 off) internal pure returns (bytes32) {
        require(s_.length >= off + 64, "hex slice oob");
        uint256 acc;
        for (uint256 i = 0; i < 64; i++) {
            acc = (acc << 4) | _hexNibble(uint8(s_[off + i]));
        }
        return bytes32(acc);
    }

    /// @dev One hex nibble (0-9, a-f, A-F) -> its value; reverts on a non-hex char.
    function _hexNibble(uint8 c) internal pure returns (uint8) {
        if (c >= 48 && c <= 57) return c - 48; // '0'-'9'
        if (c >= 97 && c <= 102) return c - 87; // 'a'-'f'
        if (c >= 65 && c <= 70) return c - 55; // 'A'-'F'
        revert("bad hex char");
    }

    /// @inheritdoc IERC2981
    /// @dev The beneficiary is the CURRENT owner of the creating agent - resolved LIVE at call time.
    ///      This is what lets the royalty stream follow the agent when the agent is sold.
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        Provenance storage p = _prov[tokenId];
        uint256 agentId = p.creatorAgentId;
        receiver = registry.ownerOf(agentId);              // current agent owner (dynamic)
        uint16 bps = registry.royaltyBpsOf(agentId);
        royaltyAmount = (salePrice * bps) / 10_000;
    }

    /// @dev Hand-rolled IERC2981 (not OZ ERC2981) -> override(ERC721, IERC165). NOTE: override(ERC721,
    ///      IERC2981) does NOT compile here because IERC2981 has no supportsInterface to override.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}
